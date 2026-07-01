import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;

export function deriveKeyFromSecret(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LEN });
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, tag, enc]).toString('base64url');
}

export function decryptSecret(blob: string, key: Buffer): string {
  const raw = Buffer.from(blob, 'base64url');
  if (raw.length < 1 + IV_LEN + AUTH_TAG_LEN + 1 || raw[0] !== 1) {
    throw new Error('Invalid encrypted token format');
  }
  const iv = raw.subarray(1, 1 + IV_LEN);
  const tag = raw.subarray(1 + IV_LEN, 1 + IV_LEN + AUTH_TAG_LEN);
  const data = raw.subarray(1 + IV_LEN + AUTH_TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LEN });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
