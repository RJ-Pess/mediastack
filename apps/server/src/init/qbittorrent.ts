import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Formato do qBittorrent: PBKDF2-HMAC-SHA512, 100000 iterações, chave de 64 bytes. */
export function qbitPasswordHash(password: string, salt = randomBytes(16)): string {
  const key = pbkdf2Sync(password, salt, 100_000, 64, 'sha512');
  return `@ByteArray(${salt.toString('base64')}:${key.toString('base64')})`;
}

export interface QbitInitOptions {
  username: string;
  password: string;
  torrentPort: number;
  /** Caminho dentro do container, ex.: /data/torrents */
  savePath: string;
  categories: Record<string, string>;
}

export function renderQbitConf(o: QbitInitOptions): string {
  return [
    '[BitTorrent]',
    `Session\\DefaultSavePath=${o.savePath}`,
    `Session\\Port=${o.torrentPort}`,
    'Session\\TempPathEnabled=false',
    '',
    '[Preferences]',
    `WebUI\\Username=${o.username}`,
    `WebUI\\Password_PBKDF2="${qbitPasswordHash(o.password)}"`,
    'WebUI\\Port=8080',
    // O Sonarr/Radarr acedem por nome de container, não por localhost.
    'WebUI\\HostHeaderValidation=false',
    'WebUI\\CSRFProtection=false',
    '',
  ].join('\n');
}

/** Escreve a config inicial só se ainda não existir (o utilizador pode ter alterado). */
export function initQbittorrent(configDir: string, o: QbitInitOptions): boolean {
  const dir = join(configDir, 'qBittorrent');
  const conf = join(dir, 'qBittorrent.conf');
  if (existsSync(conf)) return false;
  mkdirSync(dir, { recursive: true });
  writeFileSync(conf, renderQbitConf(o));
  const cats = Object.fromEntries(
    Object.entries(o.categories).map(([name, save_path]) => [name, { save_path }]),
  );
  writeFileSync(join(dir, 'categories.json'), JSON.stringify(cats, null, 2));
  return true;
}
