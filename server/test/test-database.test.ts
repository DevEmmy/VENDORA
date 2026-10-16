import assert from "node:assert/strict";
import test from "node:test";
import { assertTestDatabase } from "./support/database";

test("test database commands reject remote, production and unnamed databases", () => {
  for (const url of ["postgresql://test:test@remote.example/vendora_test",
    "postgresql://test:test@localhost/vendora", "https://localhost/vendora_test"])
    assert.throws(() => assertTestDatabase(url), /local .*_test/);
  assert.equal(assertTestDatabase("postgresql://test:test@127.0.0.1/vendora_isolated_test"),
    "postgresql://test:test@127.0.0.1/vendora_isolated_test");
});

test("test database commands refuse application database aliases and production mode", () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, DATABASE_URL: process.env.DATABASE_URL };
  try {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://app:secret@localhost:5432/vendora_alias_test";
    assert.throws(() => assertTestDatabase("postgresql://test:test@127.0.0.1/vendora_alias_test"), /must differ/);
    process.env.NODE_ENV = "production";
    assert.throws(() => assertTestDatabase("postgresql://test:test@localhost/disposable_test"), /local .*_test/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
