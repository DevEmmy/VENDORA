import { z } from "zod";

const positive = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  PORT: positive(8080),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  AUTH_PRIVATE_KEY: z.string().min(100),
  AUTH_PUBLIC_KEY: z.string().min(100),
  AUTH_KEY_ID: z.string().min(1),
  AUTH_ISSUER: z.url(),
  AUTH_AUDIENCE: z.string().min(1),
  AUTH_REFRESH_REUSE_GRACE_MS: z.coerce.number().int().min(0).max(30_000).default(10_000),
  CORS_ORIGINS: z.string().min(1),
  COOKIE_SECURE: z.enum(["true", "false"]).default("true"),
  TRUST_PROXY: z.string().default(""),
  ENABLE_DEV_ROUTES: z.enum(["true", "false"]).default("false"),
  ENABLE_WHATSAPP: z.enum(["true", "false"]).default("false"),
  INVENTORY_LAZY_BACKFILL: z.enum(['true', 'false']).default('false'),
  DATABASE_TLS: z.enum(["true", "false"]).default("true"),
  DATABASE_CA: z.string().optional(),
  DATABASE_CA_FILE: z.string().optional(),
  DATABASE_POOL_MAX: positive(5),
  WA_APP_SECRET: z.string().min(32).optional(),
  WA_VERIFY_TOKEN: z.string().min(16).optional(),
  DELIVERY_URL: z.url().optional(),
  DELIVERY_TOKEN: z.string().min(32).optional(),
  DELIVERY_ENCRYPTION_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  RECOVERY_ORIGIN: z.url().optional(),
  DATA_FILE: z.string().optional(),
});
export type Config = ReturnType<typeof loadConfig>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const c = schema.parse(
    Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")),
  );
  const origins = c.CORS_ORIGINS.split(",").map((s) => s.trim());
  if (c.DATABASE_CA && c.DATABASE_CA_FILE) throw new Error("Choose DATABASE_CA or DATABASE_CA_FILE");
  for (const origin of origins) {
    const url = new URL(origin);
    if (
      origin.includes("*") ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      (c.NODE_ENV === "production" && url.protocol !== "https:")
    )
      throw new Error("Exact trusted origins required");
  }
  const database = new URL(c.DATABASE_URL);
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    database.port === "6543"
  )
    throw new Error("Use direct PostgreSQL or session pooling");
  for (const key of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"]) {
    if (database.searchParams.has(key))
      throw new Error(
        "Configure driver TLS using DATABASE_TLS and DATABASE_CA",
      );
  }
  if (
    c.NODE_ENV === "production" &&
    (c.COOKIE_SECURE !== "true" ||
      c.DATABASE_TLS !== "true" ||
      c.ENABLE_DEV_ROUTES === "true")
  )
    throw new Error("Insecure production configuration");
  if (Boolean(c.WA_APP_SECRET) !== Boolean(c.WA_VERIFY_TOKEN))
    throw new Error("WhatsApp configuration incomplete");
  if (Boolean(c.DELIVERY_URL) !== Boolean(c.DELIVERY_TOKEN))
    throw new Error("Delivery configuration incomplete");
  if (c.DELIVERY_URL && new URL(c.DELIVERY_URL).protocol !== "https:")
    throw new Error("HTTPS delivery required");
  if (
    c.RECOVERY_ORIGIN &&
    (new URL(c.RECOVERY_ORIGIN).origin !== c.RECOVERY_ORIGIN ||
      new URL(c.RECOVERY_ORIGIN).protocol !== "https:")
  )
    throw new Error("Fixed HTTPS recovery origin required");
  return {
    ...c,
    origins,
    secureCookies: c.COOKIE_SECURE === "true",
    devRoutes: c.ENABLE_DEV_ROUTES === "true",
    whatsappEnabled: c.ENABLE_WHATSAPP === "true",
  };
}
