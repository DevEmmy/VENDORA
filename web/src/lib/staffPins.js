const iterations = 210_000;
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));

export function devicePinSalt(storage = localStorage) {
  const key = 'vendora:pin-device-salt:v1';
  let salt = storage.getItem(key);
  if (!salt) { salt = encode(crypto.getRandomValues(new Uint8Array(32))); storage.setItem(key, salt); }
  return salt;
}

export async function hashPin(pin, salt = devicePinSalt()) {
  if (!/^\d{4}$/.test(pin)) throw new Error('Choose a four-digit PIN.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const hash = encode(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: decode(salt), iterations, hash: 'SHA-256' }, key, 256));
  return { algorithm: 'PBKDF2-SHA256', iterations, salt, hash };
}
export async function verifyPin(record, pin) {
  if (!record || record.algorithm !== 'PBKDF2-SHA256' || record.iterations !== iterations || !/^\d{4}$/.test(pin)) return false;
  const candidate = await hashPin(pin, record.salt);
  let difference = candidate.hash.length ^ record.hash.length;
  for (let index = 0; index < candidate.hash.length; index++) difference |= candidate.hash.charCodeAt(index) ^ record.hash.charCodeAt(index);
  return difference === 0;
}
export async function migrateStaffPins(staff) {
  return Promise.all(staff.map(async person => {
    const { pin, ...safe } = person;
    if (typeof pin === 'string' && /^\d{4}$/.test(pin)) safe.pinHash = await hashPin(pin);
    return safe;
  }));
}
