import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { legacy, type LegacyStore } from "../adapters/legacy";
import type { Prisma } from "../generated/prisma/client";
import { asyncRoute, HttpError } from "../middleware/error-handler";
import type { AuthRepository } from "../repositories/auth.repository";
import { Authorization } from "../services/authorization.service";
import { submissionSchema, syncSchema } from "./business.routes";

const jsonObject = z.record(z.string(), z.unknown());
const inventoryProductSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    aliases: z.array(z.string().max(200)).max(20).default([]),
    unit: z.string().max(200),
    price: z.number().finite().nonnegative(),
    cost: z.number().finite().nonnegative().default(0),
    qty: z.number().finite().nonnegative(),
    lowAt: z.number().finite().nonnegative().default(0),
    updatedAt: z.number().finite().nonnegative().optional(),
  })
  .strict();

const inventoryUpdateSchema = z
  .object({
    inventory: z.array(inventoryProductSchema).max(5000),
    expectedUpdatedAt: z.string().datetime().nullable(),
  })
  .strict();
export function snapshotRoutes(repo: AuthRepository, store: LegacyStore) {
  const router = Router();
  // Read the authenticated business's saved inventory.
  router.get(
    "/api/inventory",
    asyncRoute(async (req, res) => {
      const membership = await new Authorization(repo).business(
        req.auth!,
        "sales:write",
        req.get("x-business-id"),
      );

      const snapshot = await repo.db.businessSnapshot.findUnique({
        where: {
          businessId: membership.businessId,
        },
        select: {
          state: true,
          updatedAt: true,
        },
      });

      if (!snapshot) {
        return res.json({
          inventory: [],
          initialized: false,
          updatedAt: null,
        });
      }

      const state = jsonObject.parse(snapshot.state);

      const inventory = z.array(z.unknown()).parse(state.inventory ?? []);

      return res.json({
        inventory,
        initialized: true,
        updatedAt: snapshot.updatedAt,
      });
    }),
  );
  router.put(
    "/api/inventory",
    asyncRoute(async (req, res) => {
      const membership = await new Authorization(repo).business(
        req.auth!,
        "sales:write",
        req.get("x-business-id"),
      );

      const { inventory, expectedUpdatedAt } = inventoryUpdateSchema.parse(
        req.body,
      );

      const businessId = membership.businessId;

      const result = await repo.transaction(async (tx) => {
        // Serialize inventory updates for this business.
        await tx.$queryRaw`
          SELECT id
          FROM vendora.businesses
          WHERE id = ${businessId}::uuid
          FOR UPDATE
        `;

        const existing = await tx.businessSnapshot.findUnique({
          where: { businessId },
        });

        const currentVersion = existing
          ? existing.updatedAt.toISOString()
          : null;

        if (currentVersion !== expectedUpdatedAt) {
          throw new HttpError(
            409,
            "Inventory has changed on another device. Refresh before saving.",
          );
        }

        const currentState = existing ? jsonObject.parse(existing.state) : {};

        const updatedState = {
          ...currentState,
          inventory,
          updatedAt: Date.now(),
        };

        const data = JSON.parse(
          JSON.stringify(updatedState),
        ) as Prisma.InputJsonObject;

        const saved = await tx.businessSnapshot.upsert({
          where: { businessId },
          create: { businessId, state: data },
          update: { state: data },
        });

        return {
          inventory,
          initialized: true,
          updatedAt: saved.updatedAt,
        };
      });

      res.json(result);
    }),
  );
  // Business-scoped sales. Inventory is synchronized separately.
  router.get(
    "/api/sales",
    asyncRoute(async (req, res) => {
      const membership = await new Authorization(repo).business(
        req.auth!,
        "sales:write",
        req.get("x-business-id"),
      );

      const snapshot = await repo.db.businessSnapshot.findUnique({
        where: { businessId: membership.businessId },
        select: { state: true },
      });

      const state = snapshot ? jsonObject.parse(snapshot.state) : {};
      const sales = z.array(jsonObject).parse(state.sales ?? []);

      res.json({ sales });
    }),
  );

  router.post(
    "/api/sales/sync",
    asyncRoute(async (req, res) => {
      const membership = await new Authorization(repo).business(
        req.auth!,
        "sales:write",
        req.get("x-business-id"),
      );

      const payload = z.object({
        sales: z.array(
          z.object({
            id: z.string().min(1).max(200),
            type: z.literal("sale"),
            items: z.array(jsonObject).min(1).max(500),
            amount: z.number().finite().nonnegative(),
            paid: z.number().finite().nonnegative(),
            at: z.number().finite().nonnegative(),
            reversed: z.boolean().optional(),
            reversedReason: z.string().max(1000).optional(),
          }).passthrough(),
        ).max(1000),
      }).strict().parse(req.body);

      const businessId = membership.businessId;

      const result = await repo.transaction(async (tx) => {
        // Serialize snapshot writes for this business.
        await tx.$queryRaw`
          SELECT id
          FROM vendora.businesses
          WHERE id = ${businessId}::uuid
          FOR UPDATE
        `;

        const existing = await tx.businessSnapshot.findUnique({
          where: { businessId },
        });

        const state = existing ? jsonObject.parse(existing.state) : {};
        const savedSales = z.array(jsonObject).parse(state.sales ?? []);

      const normalizeJson = (value: unknown): string => {
        if (Array.isArray(value)) {
          return `[${value.map(normalizeJson).join(",")}]`;
        }

        if (value !== null && typeof value === "object") {
          const object = value as Record<string, unknown>;

          return `{${Object.keys(object)
            .sort()
            .map(
              (key) =>
                `${JSON.stringify(key)}:${normalizeJson(object[key])}`,
            )
            .join(",")}}`;
        }

        return JSON.stringify(value);
      };
        const byId = new Map<string, Record<string, unknown>>();

        for (const sale of savedSales) {
          if (typeof sale.id !== "string") {
            throw new HttpError(409, "Stored sales data is invalid");
          }

          if (byId.has(sale.id)) {
            throw new HttpError(409, "Duplicate stored sale ID");
          }

          byId.set(sale.id, sale);
        }

        for (const incoming of payload.sales) {
          const current = byId.get(incoming.id);

          if (!current) {
            byId.set(incoming.id, incoming);
            continue;
          }

          // Existing sale details are immutable.
          // Only reversal status may change.
          const {
            reversed: _oldReversed,
            reversedReason: _oldReason,
            ...oldBase
          } = current;

          const {
            reversed: _newReversed,
            reversedReason: _newReason,
            ...newBase
          } = incoming;

          if (normalizeJson(oldBase) !== normalizeJson(newBase)) {
            throw new HttpError(
              409,
              "A sale with this ID already exists with different details",
            );
          }

          // A reversed sale cannot become active again.
          if (current.reversed === true && incoming.reversed !== true) {
            continue;
          }

          if (incoming.reversed === true) {
            if (
              current.reversed === true &&
              current.reversedReason !== incoming.reversedReason
            ) {
              throw new HttpError(
                409,
                "This sale was already reversed with a different reason",
              );
            }

            byId.set(incoming.id, {
              ...current,
              reversed: true,
              reversedReason: incoming.reversedReason ?? "Reversed",
            });
          }
        }

        const sales = [...byId.values()];

        const updatedState = {
          ...state,
          sales,
        };

        const data = JSON.parse(
          JSON.stringify(updatedState),
        ) as Prisma.InputJsonObject;

        await tx.businessSnapshot.upsert({
          where: { businessId },
          create: { businessId, state: data },
          update: { state: data },
        });

        return {
          sales,
          count: sales.length,
        };
      });

      res.json(result);
    }),
  );

  router.post(
    "/api/whatsapp/link",
    asyncRoute(async (req, res) => {
      if (!z.object({}).strict().safeParse(req.body).success)
        throw new HttpError(400, "Invalid request");
      const membership = await new Authorization(repo).business(
        req.auth!,
        "sales:write",
        req.get("x-business-id"),
      );
      if (
        membership.business.phone !== req.auth!.user.phone ||
        Date.now() - req.auth!.session.authenticatedAt.getTime() > 5 * 60_000
      )
        throw new HttpError(
          403,
          "Verified business phone and recent authentication required",
        );
      await repo.transaction(async (tx) => {
        await tx.business.update({
          where: { id: membership.businessId },
          data: { whatsappLinkedAt: new Date() },
        });
        await repo.audit(
          "whatsapp-link",
          "success",
          res.locals.requestId,
          req.auth!.user.id,
          req.auth!.session.id,
          tx,
        );
      });
      res.sendStatus(204);
    }),
  );
  router.post(
    "/api/sync",
    asyncRoute(async (req, res) => {
      const b = syncSchema.parse(req.body);
      const businessId: string = res.locals.membership.businessId;
      const phone: string = res.locals.membership.business.phone;
      const result = await repo.transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM vendora.businesses WHERE id = ${businessId}::uuid FOR UPDATE`;
        const old = await tx.businessSnapshot.findUnique({
          where: { businessId },
        });
        const state = old ? jsonObject.parse(old.state) : {};
        const seals = z
          .array(
            z.object({
              seq: z.number(),
              hash: z.string(),
              sig: z.string().nullable(),
              at: z.number(),
            }),
          )
          .parse(state.seals ?? []);
        let sealOk = true;
        if (b.ledgerHead) {
          const h = b.ledgerHead;
          const last = seals.at(-1);
          const same = seals.find((a) => a.seq === h.seq);
          if ((last && h.seq < last.seq) || (same && same.hash !== h.hash)) {
            sealOk = false;
            state.sealAlert = {
              at: Date.now(),
              head: h,
              expected: same ?? last,
            };
          } else if (!last || h.seq > last.seq)
            seals.push({
              seq: h.seq,
              hash: h.hash,
              sig: h.sig ?? null,
              at: Date.now(),
            });
          if (h.key && !state.deviceKey) state.deviceKey = h.key;
        }
        const updated = {
          ...state,
          ...b.profile,
          phone,
          inventory: b.inventory,
          customers: b.customers,
          seals: seals.slice(-500),
          updatedAt: Date.now(),
        };
        await tx.channelEntry.deleteMany({
          where: { businessId, seq: { lte: b.ackedThrough } },
        });
        const entries = await tx.channelEntry.findMany({
          where: { businessId },
          orderBy: { seq: "asc" },
        });
        for (const entry of entries) {
          const op = jsonObject.parse(entry.op);
          if (op.type !== "voice_pending") legacy.applyOp(updated, op);
        }
        const data = JSON.parse(
          JSON.stringify(updated),
        ) as Prisma.InputJsonObject;
        await tx.businessSnapshot.upsert({
          where: { businessId },
          create: { businessId, state: data },
          update: { state: data },
        });
        let credits: Record<string, unknown>[] = [];
        if (
          res.locals.membership.permissions.includes("bank:read") &&
          typeof state.accountNumber === "string"
        ) {
          const account = await tx.resourceOwnership.findUnique({
            where: {
              kind_resourceId: {
                kind: "account",
                resourceId: state.accountNumber,
              },
            },
          });
          if (!account || account.businessId !== businessId)
            throw new HttpError(404, "Not found");
          credits = store.data.credits.filter(
            (c) =>
              c.accountNumber === state.accountNumber &&
              typeof c.at === "number" &&
              c.at > b.creditsSince,
          );
        }
        return {
          entries: entries.map((e) => ({
            seq: e.seq,
            phone: e.phone,
            source: e.source,
            text: e.text,
            op: e.op,
            at: e.at.getTime(),
          })),
          credits,
          sealOk,
          serverTime: Date.now(),
        };
      });
      res.json(result);
    }),
  );
  router.post(
    "/api/submissions",
    asyncRoute(async (req, res) => {
      const b = submissionSchema.parse(req.body);
      const businessId: string = res.locals.membership.businessId;
      const bytes = Buffer.from(b.file, "base64");
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (hash !== b.sha256)
        throw new HttpError(422, "File fingerprint mismatch");
      const id = randomUUID();
      const metadata = {
        id,
        phone: res.locals.membership.business.phone as string,
        accountNumber: b.accountNumber ?? null,
        fileName: b.fileName ?? "records.xlsx",
        sha256: hash,
        from: b.from ?? 0,
        to: b.to ?? 0,
        invoices: b.invoices ?? 0,
        total: b.total ?? 0,
        size: bytes.length,
        at: Date.now(),
        status: "Received by Wema",
      };
      await repo.transaction(async (tx) => {
        if (b.accountNumber) {
          const account = await tx.resourceOwnership.findUnique({
            where: {
              kind_resourceId: { kind: "account", resourceId: b.accountNumber },
            },
          });
          if (!account || account.businessId !== businessId)
            throw new HttpError(404, "Not found");
        }
        await tx.submission.create({
          data: { id, businessId, metadata, file: bytes },
        });
        await tx.resourceOwnership.create({
          data: { kind: "submission", resourceId: id, businessId },
        });
      });
      res.status(201).json(metadata);
    }),
  );
  router.get(
    "/api/submissions",
    asyncRoute(async (_req, res) => {
      const businessId: string = res.locals.membership.businessId;
      const submissions = await repo.db.submission.findMany({
        where: { businessId },
        select: { metadata: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      res.json(submissions.map((s) => s.metadata));
    }),
  );
  return router;
}
