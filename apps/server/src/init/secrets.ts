import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Segredos gerados no primeiro arranque; cada um fica num ficheiro próprio em `dir`. */
export const SECRET_NAMES = [
  'sonarr.key',
  'radarr.key',
  'prowlarr.key',
  'bazarr.key',
  'seerr.key',
  'qbittorrent.password',
  'cais.secret',
] as const;

export type SecretName = (typeof SECRET_NAMES)[number];

const generate = (name: SecretName) =>
  name.endsWith('.key')
    ? randomBytes(16).toString('hex')
    : randomBytes(name === 'cais.secret' ? 32 : 18).toString('base64url');

/** Cria os segredos em falta. Nunca sobrescreve os existentes (idempotente). */
export function ensureSecrets(dir: string): Record<SecretName, string> {
  mkdirSync(dir, { recursive: true });
  const out = {} as Record<SecretName, string>;
  for (const name of SECRET_NAMES) {
    const file = join(dir, name);
    if (!existsSync(file)) {
      // Sem newline final: as variáveis FILE__ do linuxserver usam o conteúdo tal como está.
      writeFileSync(file, generate(name), { mode: 0o644 });
      chmodSync(file, 0o644); // legível pelos outros containers (PUID diferente); volume só interno
    }
    out[name] = readFileSync(file, 'utf8').trim();
  }
  return out;
}

/** Lê (sem criar) os segredos gerados pelo init. */
export function readSecrets(dir: string): Record<SecretName, string> {
  const out = {} as Record<SecretName, string>;
  for (const name of SECRET_NAMES) out[name] = readFileSync(join(dir, name), 'utf8').trim();
  return out;
}
