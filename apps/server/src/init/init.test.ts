import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { pbkdf2Sync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { qbitPasswordHash } from './qbittorrent.js';
import { ownedDirs, runInit } from './index.js';
import { ensureSecrets } from './secrets.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'mediastack-'));

describe('qbitPasswordHash', () => {
  it('é verificável com PBKDF2-SHA512', () => {
    const h = qbitPasswordHash('segredo', Buffer.from('0123456789abcdef'));
    const m = /^@ByteArray\((.+):(.+)\)$/.exec(h)!;
    const expected = pbkdf2Sync('segredo', Buffer.from(m[1]!, 'base64'), 100_000, 64, 'sha512');
    expect(Buffer.from(m[2]!, 'base64').equals(expected)).toBe(true);
  });
});

describe('ensureSecrets', () => {
  it('gera chaves de 32 hex e não as altera no segundo arranque', () => {
    const dir = tmp();
    const a = ensureSecrets(dir);
    expect(a['sonarr.key']).toMatch(/^[0-9a-f]{32}$/);
    expect(ensureSecrets(dir)).toEqual(a);
  });
});

describe('runInit', () => {
  it('não sobrescreve configs existentes', () => {
    const root = tmp();
    const opts = { secretsDir: join(tmp(), 's'), configRoot: root, torrentPort: 6882 };
    runInit(opts);
    const conf = join(root, 'qbittorrent', 'qBittorrent', 'qBittorrent.conf');
    writeFileSync(conf, 'editado');
    runInit(opts);
    expect(readFileSync(conf, 'utf8')).toBe('editado');
  });
});

describe('ownedDirs', () => {
  it('inclui todas as pastas que os containers não-root escrevem', () => {
    const dirs = ownedDirs({ secretsDir: '/run/mediastack', configRoot: '/configs' });
    expect(dirs).toEqual(
      expect.arrayContaining([
        '/configs/mediastack/data', // base de dados do MediaStack
        '/configs/mediastack/recyclarr', // pedidos/resultado do Recyclarr
        '/run/mediastack',
        '/configs/qbittorrent',
        '/configs/bazarr',
      ]),
    );
  });
});
