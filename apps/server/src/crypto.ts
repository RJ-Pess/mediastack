import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/** AES-256-GCM com chave derivada de MEDIASTACK_SECRET. Formato: base64(iv | tag | dados). */
export function createVault(secret: string) {
  const key = scryptSync(secret, 'mediastack-vault-v1', 32);
  return {
    encrypt(plain: string): string {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
    },
    decrypt(blob: string): string {
      const raw = Buffer.from(blob, 'base64');
      const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
    },
  };
}

export type Vault = ReturnType<typeof createVault>;
