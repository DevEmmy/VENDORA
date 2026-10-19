import { z } from "zod";
import type { createDeliveryQueue } from "../adapters/delivery-queue";
import { legacy } from "../adapters/legacy";
import type { Prisma } from "../generated/prisma/client";
import type { AuthRepository } from "../repositories/auth.repository";

export function createWebhookWorker(
  repo: AuthRepository,
  queue: ReturnType<typeof createDeliveryQueue>,
) {
  return async function processOne() {
    await repo.transaction(async (tx) => {
      const ids = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM vendora.webhook_events WHERE "processedAt" IS NULL ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!ids[0]) return;
      const event = await tx.webhookEvent.findUniqueOrThrow({
        where: { id: ids[0].id },
      });
      const m = z
        .object({
          from: z.string(),
          type: z.string(),
          text: z.object({ body: z.string() }).optional(),
          audio: z.object({ id: z.string() }).optional(),
        })
        .parse(event.payload);
      const business = await tx.business.findUnique({
        where: { phone: m.from },
      });
      if (business?.whatsappLinkedAt) {
        await tx.$queryRaw`SELECT id FROM vendora.businesses WHERE id = ${business.id}::uuid FOR UPDATE`;
        const member = await tx.membership.findFirst({
          where: {
            businessId: business.id,
            status: "active",
            permissions: { has: "sales:write" },
            user: {
              phone: m.from,
              status: "active",
            },
          },
        });
        const snapshot = await tx.businessSnapshot.findUnique({
          where: { businessId: business.id },
        });
        const current = await tx.business.findUniqueOrThrow({ where: { id: business.id }, select: { inventoryMode: true } });
        if (member && current.inventoryMode === 'RELATIONAL') {
          await queue.enqueue('whatsapp-reply', m.from,
            'This shop now uses Vendora inventory sync. Open the Vendora app to record or check stock. This message has not recorded a sale.', tx);
        } else if (member && snapshot) {
          const state = z.record(z.string(), z.unknown()).parse(snapshot.state);
          const op =
            m.type === "text" && m.text
              ? legacy.parse(m.text.body, {
                  inventory: state.inventory ?? [],
                  customers: state.customers ?? [],
                })
              : { type: "voice_pending", mediaId: m.audio?.id ?? null };
          const kind = String(op.type);
          if (kind.startsWith("query_"))
            await queue.enqueue(
              "whatsapp-reply",
              m.from,
              legacy.answer(state, op),
              tx,
            );
          else if (
            ["sale", "restock", "debt_payment", "voice_pending"].includes(kind)
          ) {
            legacy.applyOp(state, op);
            await tx.businessSnapshot.update({
              where: { businessId: business.id },
              data: {
                state: JSON.parse(
                  JSON.stringify(state),
                ) as Prisma.InputJsonObject,
              },
            });
            await tx.channelEntry.create({
              data: {
                businessId: business.id,
                phone: m.from,
                source: "whatsapp",
                text: m.text?.body ?? null,
                op: JSON.parse(JSON.stringify(op)) as Prisma.InputJsonObject,
              },
            });
            await queue.enqueue(
              "whatsapp-reply",
              m.from,
              kind === "voice_pending"
                ? "Voice note received. Open Vendora to confirm it."
                : "Recorded. Open Vendora for details.",
              tx,
            );
          } else
            await queue.enqueue(
              "whatsapp-reply",
              m.from,
              "Please send a sale, restock, or debt payment.",
              tx,
            );
        }
      }
      await tx.webhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
    });
  };
}
