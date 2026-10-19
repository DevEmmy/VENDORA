
import assert from "node:assert/strict";
import test from "node:test";
import {
  encryptOfflineData,
  decryptOfflineData,
} from "../src/features/security/offlineCrypto.js";

const password = "SecureVendoraPassword2026!";

const sampleData = {
  businessId: "qa-store",
  products: [
    { name: "Test Rice", quantity: 7, price: 2500 },
  ],
  pendingSales: [
    { id: "offline-sale-1", quantity: 1 },
  ],
};

test("encrypts and decrypts offline business records", async () => {
  const encrypted = await encryptOfflineData(password, sampleData);

  assert.equal(encrypted.version, 1);
  assert.equal(encrypted.algorithm, "AES-256-GCM");
  assert.equal(encrypted.kdf, "PBKDF2-SHA256");

  assert.ok(encrypted.ciphertext);
  assert.equal(JSON.stringify(encrypted).includes("Test Rice"), false);

  const decrypted = await decryptOfflineData(password, encrypted);

  assert.deepEqual(decrypted, sampleData);
});

test("rejects an incorrect offline password", async () => {
  const encrypted = await encryptOfflineData(password, sampleData);

  await assert.rejects(
    decryptOfflineData("IncorrectPassword123!", encrypted),
    /Unable to unlock offline data/
  );
});

test("detects tampered encrypted records", async () => {
  const encrypted = await encryptOfflineData(password, sampleData);

  const modified = {
    ...encrypted,
    ciphertext: encrypted.ciphertext.slice(0, -4) + "AAAA",
  };

  await assert.rejects(
    decryptOfflineData(password, modified),
    /Unable to unlock offline data/
  );
});

test("uses unique randomness for each encryption", async () => {
  const first = await encryptOfflineData(password, sampleData);
  const second = await encryptOfflineData(password, sampleData);

  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test("rejects unsupported encrypted record versions", async () => {
  const encrypted = await encryptOfflineData(password, sampleData);

  await assert.rejects(
    decryptOfflineData(password, { ...encrypted, version: 99 }),
    /Unsupported encrypted offline record/
  );
});
