
const VERSION = 1;
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const encoder = new TextEncoder();

function cryptoProvider() {
  const provider = globalThis.crypto;

  if (!provider?.subtle || !provider?.getRandomValues) {
    throw new Error("Secure offline encryption is unavailable.");
  }

  return provider;
}

function encodeBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value) {
  if (typeof value !== "string") {
    throw new Error("Invalid encrypted account key.");
  }

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

function requireScope(userId, businessId) {
  if (
    typeof userId !== "string" ||
    !userId.trim() ||
    typeof businessId !== "string" ||
    !businessId.trim()
  ) {
    throw new Error("A verified user and business are required.");
  }
}

async function passwordKey(password, salt) {
  if (typeof password !== "string" || !password) {
    throw new Error("An account password is required.");
  }

  const crypto = cryptoProvider();

  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: ITERATIONS,
      salt,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function createAccountKey() {
  const crypto = cryptoProvider();

  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function wrapAccountKey(
  accountKey,
  password,
  userId,
  businessId
) {
  requireScope(userId, businessId);

  const crypto = cryptoProvider();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const wrappingKey = await passwordKey(password, salt);
  const rawAccountKey = await crypto.subtle.exportKey("raw", accountKey);

  const scope = JSON.stringify([userId, businessId]);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(scope),
    },
    wrappingKey,
    rawAccountKey
  );

  return {
    version: VERSION,
    algorithm: "AES-256-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: ITERATIONS,
    userId,
    businessId,
    salt: encodeBase64(salt),
    iv: encodeBase64(iv),
    wrappedKey: encodeBase64(new Uint8Array(ciphertext)),
  };
}

export async function unlockAccountKey(
  record,
  password,
  userId,
  businessId
) {
  requireScope(userId, businessId);

  if (
    !record ||
    record.version !== VERSION ||
    record.algorithm !== "AES-256-GCM" ||
    record.kdf !== "PBKDF2-SHA256" ||
    record.iterations !== ITERATIONS ||
    record.userId !== userId ||
    record.businessId !== businessId
  ) {
    throw new Error("Invalid or mismatched account key.");
  }

  try {
    const crypto = cryptoProvider();

    const salt = decodeBase64(record.salt);
    const iv = decodeBase64(record.iv);
    const wrappedKey = decodeBase64(record.wrappedKey);

    if (
      salt.length !== SALT_BYTES ||
      iv.length !== IV_BYTES ||
      wrappedKey.length !== 48
    ) {
      throw new Error("Invalid encrypted account key.");
    }

    const wrappingKey = await passwordKey(password, salt);

    const rawKey = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode(
          JSON.stringify([userId, businessId])
        ),
      },
      wrappingKey,
      wrappedKey
    );

    return crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  } catch {
    throw new Error(
      "Unable to unlock this account. The password may be incorrect or the local key may be damaged."
    );
  }
}

export async function rewrapAccountKey(
  record,
  currentPassword,
  newPassword,
  userId,
  businessId
) {
  const accountKey = await unlockAccountKey(
    record,
    currentPassword,
    userId,
    businessId
  );

  return wrapAccountKey(
    accountKey,
    newPassword,
    userId,
    businessId
  );
}
