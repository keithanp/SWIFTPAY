import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function keyFromSecret(secret: string): Buffer {
  return scryptSync(secret, 'swiftpay-credentials', 32);
}

export type EncryptedBlob = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
};

export function encryptString(plain: string, secret: string): EncryptedBlob {
  const key = keyFromSecret(secret);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function decryptString(blob: EncryptedBlob, secret: string): string {
  const key = keyFromSecret(secret);
  const decipher = createDecipheriv(ALGO, key, blob.iv);
  decipher.setAuthTag(blob.authTag);
  return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]).toString('utf8');
}
