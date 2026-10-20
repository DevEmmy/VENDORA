// Prints fresh server secrets, ready to paste into Render's Environment page.
// Run on your own computer:  node scripts/generate-secrets.mjs
// Nothing is saved or sent anywhere. Never commit the output.
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const oneLine = pem => pem.trim().replace(/\r?\n/g, '\\n');
const today = new Date().toISOString().slice(0, 10);

console.log('Copy each line into Render (Key = left of "=", Value = everything after the first "=").\n');
console.log(`AUTH_KEY_ID=vendora-${today}`);
console.log(`AUTH_PRIVATE_KEY=${oneLine(privateKey)}`);
console.log(`AUTH_PUBLIC_KEY=${oneLine(publicKey)}`);
console.log(`DELIVERY_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
console.log(`RUNTIME_DB_PASSWORD (for the Supabase step)=${randomBytes(24).toString('base64url')}`);
