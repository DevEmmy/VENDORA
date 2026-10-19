import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Config } from "../config/env";
import type {
  AuthRepository,
  Transaction,
} from "../repositories/auth.repository";
import type { Delivery } from "./delivery";

export function createDeliveryQueue(
  repo: AuthRepository,
  config: Config,
  provider: Delivery,
) {
  const key = Buffer.from(config.DELIVERY_ENCRYPTION_KEY, "base64");
  function encrypt(value: object) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      "base64",
    );
  }
  async function enqueue(
    purpose: string,
    destination: string,
    proof = "",
    tx: Transaction = repo.db,
  ) {
    await tx.deliveryJob.create({
      data: {
        ciphertext: encrypt({ purpose, destination, proof }),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
  }
  const delivery: Delivery = {
    sendVerification: (destination, code) =>
      enqueue("verification", destination, code),
    sendRecovery: (destination, token) =>
      enqueue("recovery", destination, token),
    notify: (destination) => enqueue("notification", destination),
    sendMessage: (destination, text) =>
      enqueue("whatsapp-reply", destination, text),
  };
  async function drain() {
    const job = await repo.transaction(async (tx) => {
      const ids = await tx.$queryRaw<
        { id: string }[]
      // Prisma DateTime fields here are UTC timestamp WITHOUT time zone. An
      // implicit comparison with timestamptz NOW() expires jobs an hour early
      // on a Lagos database connection. Normalize the database clock explicitly.
      >`SELECT id FROM vendora.delivery_jobs WHERE "expiresAt" > (NOW() AT TIME ZONE 'UTC') AND attempts < 5 AND ("leaseUntil" IS NULL OR "leaseUntil" < (NOW() AT TIME ZONE 'UTC')) ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!ids[0]) return null;
      return tx.deliveryJob.update({
        where: { id: ids[0].id },
        data: {
          leaseUntil: new Date(Date.now() + 60_000),
          attempts: { increment: 1 },
        },
      });
    });
    if (!job) return;
    const buffer = Buffer.from(job.ciphertext, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      buffer.subarray(0, 12),
    );
    decipher.setAuthTag(buffer.subarray(12, 28));
    const value: unknown = JSON.parse(
      Buffer.concat([
        decipher.update(buffer.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
    const payload = z
      .object({
        purpose: z.enum([
          "verification",
          "recovery",
          "notification",
          "whatsapp-reply",
        ]),
        destination: z.string(),
        proof: z.string(),
      })
      .parse(value);
    if (payload.purpose === "verification")
      await provider.sendVerification(payload.destination, payload.proof);
    else if (payload.purpose === "recovery")
      await provider.sendRecovery(payload.destination, payload.proof);
    else if (payload.purpose === "whatsapp-reply") {
      if (!config.whatsappEnabled) return;
      await provider.sendMessage(payload.destination, payload.proof);
    }
    else await provider.notify(payload.destination);
    await repo.db.deliveryJob.delete({ where: { id: job.id } });
  }
  return { delivery, drain, enqueue };
}
