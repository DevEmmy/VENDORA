
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
  createAccountKey,
  wrapAccountKey,
  unlockAccountKey,
  rewrapAccountKey,
} from "../src/features/security/accountKey.js";

// Ensure Web Crypto is available in the Node.js test environment.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
}

const USER_ID = "test-user-001";
const BUSINESS_ID = "test-business-001";
const PASSWORD = "VendoraTestPassword123!";
const NEW_PASSWORD = "VendoraNewPassword456!";

async function exportKey(key) {
  return Buffer.from(
    await globalThis.crypto.subtle.exportKey("raw", key)
  ).toString("hex");
}

test("creates and unlocks an account encryption key", async () => {
  const key = await createAccountKey();

  const wrapped = await wrapAccountKey(
    key,
    PASSWORD,
    USER_ID,
    BUSINESS_ID
  );

  const unlocked = await unlockAccountKey(
    wrapped,
    PASSWORD,
    USER_ID,
    BUSINESS_ID
  );

  assert.equal(await exportKey(unlocked), await exportKey(key));
  assert.equal(wrapped.userId, USER_ID);
  assert.equal(wrapped.businessId, BUSINESS_ID);
});

test("rejects an incorrect password", async () => {
  const key = await createAccountKey();
  const wrapped = await wrapAccountKey(
    key,
    PASSWORD,
    USER_ID,
    BUSINESS_ID
  );

  await assert.rejects(
    unlockAccountKey(
      wrapped,
      "IncorrectPassword!",
      USER_ID,
      BUSINESS_ID
    ),
    /Unable to unlock/
  );
});

test("prevents unlocking another user's or business's key", async () => {
  const key = await createAccountKey();
  const wrapped = await wrapAccountKey(
    key,
    PASSWORD,
    USER_ID,
    BUSINESS_ID
  );

  await assert.rejects(
    unlockAccountKey(
      wrapped,
      PASSWORD,
      "another-user",
      BUSINESS_ID
    ),
    /Invalid or mismatched/
  );

  await assert.rejects(
    unlockAccountKey(
      wrapped,
      PASSWORD,
      USER_ID,
      "another-business"
    ),
    /Invalid or mismatched/
  );
});

test("rewraps the same account key with a new password", async () => {
  const key = await createAccountKey();
  const original = await wrapAccountKey(
    key,
    PASSWORD,
    USER_ID,
    BUSINESS_ID
  );

  const updated = await rewrapAccountKey(
    original,
    PASSWORD,
    NEW_PASSWORD,
    USER_ID,
    BUSINESS_ID
  );

  const unlocked = await unlockAccountKey(
    updated,
    NEW_PASSWORD,
    USER_ID,
    BUSINESS_ID
  );

  assert.equal(await exportKey(unlocked), await exportKey(key));

  await assert.rejects(
    unlockAccountKey(
      updated,
      PASSWORD,
      USER_ID,
      BUSINESS_ID
    ),
    /Unable to unlock/
  );
});

test("rejects tampered encrypted account keys", async () => {
  const key = await createAccountKey();
  const wrapped = await wrapAccountKey(
    key,
    PASSWORD,
    USER_ID,
    BUSINESS_ID
  );

  const bytes = Buffer.from(wrapped.wrappedKey, "base64");
  bytes[0] ^= 0xff;

  const tampered = {
    ...wrapped,
    wrappedKey: bytes.toString("base64"),
  };

  await assert.rejects(
    unlockAccountKey(
      tampered,
      PASSWORD,
      USER_ID,
      BUSINESS_ID
    ),
    /Unable to unlock/
  );
});

test("rejects unsupported key record versions", async () => {
  const key = await createAccountKey();
  const wrapped = await wrapAccountKey(
    key,
    PASSWORD,
    USER_ID,
    BUSINESS_ID
  );

  await assert.rejects(
    unlockAccountKey(
      { ...wrapped, version: 999 },
      PASSWORD,
      USER_ID,
      BUSINESS_ID
    ),
    /Invalid or mismatched/
  );
});
