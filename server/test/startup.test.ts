import test from "node:test";
import assert from "node:assert/strict";
import { ZodError } from "zod";
import { startupHint } from "../src/services/startup-diagnostics";
import { loadConfig } from "../src/config/env";
import { env } from "./helpers";

test("startup hints identify TLS failures without exposing connection secrets", () => {
  const hint = startupHint("database", { meta: { driverAdapterError: { cause: { code: "SELF_SIGNED_CERT_IN_CHAIN", message: "failed postgres://user:private-password@host/db" } } } });
  assert(hint.includes("DATABASE_CA_FILE")); assert(!hint.includes("private-password"));
  assert(startupHint("Redis", new Error("rediss://private-password@host")).includes("TCP URL"));
  assert(!startupHint("Redis", new Error("rediss://private-password@host")).includes("private-password"));
});

test("startup hints explain an occupied HTTP port", () => {
  const hint = startupHint("HTTP listener", { code: "EADDRINUSE" });
  assert(hint.includes("PORT is already in use"));
});

test("background diagnostics identify database failures and delivery setup without leaking secrets", () => {
  assert(startupHint("database", { code: "42501", message: "postgres://private-secret@host/db" }).includes("runtime grants"));
  assert(startupHint("database", { code: "P2022" }).includes("columns are missing"));
  assert(startupHint("database", { code: "P2028" }).includes("timed out"));
  const hint = startupHint("delivery", new Error("https://private-secret@gateway.test"));
  assert(hint.includes("DELIVERY_URL"));
  assert(!hint.includes("private-secret"));
});
test("configuration hints report field names and CA settings are mutually exclusive", () => {
  const error = new ZodError([{ code: "custom", path: ["AUTH_PRIVATE_KEY"], message: "secret input" }]);
  assert.equal(startupHint("configuration", error), "Invalid environment fields: AUTH_PRIVATE_KEY");
  assert.throws(() => loadConfig({ ...env, DATABASE_CA: "inline certificate", DATABASE_CA_FILE: "certs/provider.crt" }));
});
