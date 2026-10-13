import { PrismaPg } from "@prisma/adapter-pg";
import type { Config } from "../config/env";
import { PrismaClient } from "../generated/prisma/client";
import { readFileSync } from "node:fs";

export function createDatabase(config: Config) {
  const ca = config.DATABASE_CA_FILE ? readFileSync(config.DATABASE_CA_FILE, "utf8") : config.DATABASE_CA?.replace(/\\n/g, "\n");
  const adapter = new PrismaPg({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    query_timeout: 12_000,
    ssl:
      config.DATABASE_TLS === "true"
        ? {
            rejectUnauthorized: true,
            ...(ca ? { ca } : {}),
          }
        : false,
  });
  return new PrismaClient({ adapter });
}
