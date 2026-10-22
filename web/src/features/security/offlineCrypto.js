
const VERSION = 1;
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function getCrypto() {
  const cryptoApi = globalThis.crypto;

  if (!cryptoApi?.subtle || !cryptoApi?.getRandomValues) {
    throw new Error("Secure offline encryption is unavailable on this device.");
  }

  return cryptoApi;
}

function toBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  if (typeof value !== "string") {
    throw new Error("Invalid encrypted record.");
  }

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function deriveKey(password, salt) {
  const cryptoApi = getCrypto();

  if (typeof password !== "string" || !password.length) {
    throw new Error("An account password is required.");
  }

  const material = await cryptoApi.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return cryptoApi.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    material,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptOfflineData(password, data) {
  const cryptoApi = getCrypto();

  const salt = cryptoApi.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = cryptoApi.getRandomValues(new Uint8Array(IV_BYTES));

  const key = await deriveKey(password, salt);

  const plaintext = encoder.encode(JSON.stringify(data));

  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );

  return {
    version: VERSION,
    algorithm: "AES-256-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptOfflineData(password, record) {
  if (
    !record ||
    record.version !== VERSION ||
    record.algorithm !== "AES-256-GCM" ||
    record.kdf !== "PBKDF2-SHA256" ||
    record.iterations !== ITERATIONS
  ) {
    throw new Error("Unsupported encrypted offline record.");
  }

  try {
    const salt = fromBase64(record.salt);
    const iv = fromBase64(record.iv);
    const ciphertext = fromBase64(record.ciphertext);

    if (
      salt.length !== SALT_BYTES ||
      iv.length !== IV_BYTES ||
      ciphertext.length < 16
    ) {
      throw new Error("Invalid encrypted record.");
    }

    const key = await deriveKey(password, salt);

    const plaintext = await getCrypto().subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );

    return JSON.parse(decoder.decode(plaintext));
  } catch {
    throw new Error(
      "Unable to unlock offline data. The password may be incorrect or the record may be damaged."
    );
  }
}
