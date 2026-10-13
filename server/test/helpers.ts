import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { Delivery } from "../src/adapters/delivery";
import { loadConfig } from "../src/config/env";
import type { Session, User } from "../src/generated/prisma/client";

const keys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
export const env = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/vendora_test",
  DATABASE_TLS: "false",
  REDIS_URL: "redis://localhost:6379",
  AUTH_PRIVATE_KEY: keys.privateKey,
  AUTH_PUBLIC_KEY: keys.publicKey,
  AUTH_KEY_ID: "test-key",
  AUTH_ISSUER: "https://vendora.test",
  AUTH_AUDIENCE: "web",
  DELIVERY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  CORS_ORIGINS: "https://vendora.test",
};
export const config = loadConfig(env);
export const delivery: Delivery = {
  sendVerification: async () => {},
  sendRecovery: async () => {},
  notify: async () => {},
  sendMessage: async () => {},
};
export function identity() {
  const now = new Date();
  const user: User = {
    id: randomUUID(),
    phone: "2348030000000",
    passwordHash: "unused",
    phoneVerifiedAt: now,
    status: "active",
    authVersion: 0,
    createdAt: now,
    updatedAt: now,
    recoveryDestination: null,
    recoveryVerifiedAt: null,
  };
  const session: Session = {
    id: randomUUID(),
    userId: user.id,
    csrf: "csrf-test",
    authVersion: 0,
    authenticatedAt: now,
    lastActivityAt: now,
    idleExpiresAt: new Date(Date.now() + 30 * 60_000),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
    revokedAt: null,
    mfaLevel: 0,
  };
  return { user, session };
}
