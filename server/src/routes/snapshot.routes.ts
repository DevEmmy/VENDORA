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
export function snapshotRoutes(repo: AuthRepository, store: LegacyStore) {
  const router = Router();
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
        if (res.locals.membership.permissions.includes("bank:read") && typeof state.accountNumber === "string") {
          const account = await tx.resourceOwnership.findUnique({ where: { kind_resourceId: { kind: "account", resourceId: state.accountNumber } } });
          if (!account || account.businessId !== businessId) throw new HttpError(404, "Not found");
          credits = store.data.credits.filter(c => c.accountNumber === state.accountNumber && typeof c.at === "number" && c.at > b.creditsSince);
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
