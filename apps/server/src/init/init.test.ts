import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { pbkdf2Sync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { qbitPasswordHash } from './qbittorrent.js';
import {
  chownTree,
  ensureWritableRoot,
  installRecyclarrScript,
  ownedDirs,
  runInit,
} from './index.js';
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
        '/configs/seerr', // o Seerr (não-root) crashava sem a posse desta pasta
      ]),
    );
  });
});

describe('raiz de dados', () => {
  it('o init já não cria pastas na biblioteca (isso é feito pela UI)', () => {
    const data = mkdtempSync(join(tmpdir(), 'mediastack-data-'));
    runInit({ secretsDir: join(tmp(), 's'), configRoot: tmp(), torrentPort: 6882, dataRoot: data });
    expect(readdirSync(data)).toEqual([]);
  });

  it('só toma conta da raiz se for de root (criada pelo Docker); nunca altera a tua biblioteca', () => {
    const own = { uid: 1000, gid: 1000 };
    const dir = mkdtempSync(join(tmpdir(), 'mediastack-data-'));
    // pertence ao utilizador que corre os testes (não é root): não é tocada
    expect(ensureWritableRoot(dir, own)).toBe(false);
    expect(ensureWritableRoot('/nao/existe', own)).toBe(false);
    expect(ensureWritableRoot(dir, undefined)).toBe(false);
  });
});

describe('installRecyclarrScript', () => {
  it('copia o script para a pasta do Recyclarr e mantém-no atualizado', () => {
    const src = join(tmp(), 'sync.sh');
    const dest = tmp();
    writeFileSync(src, '#!/bin/sh\necho v1\n');
    expect(installRecyclarrScript(src, dest)).toBe(true);
    expect(readFileSync(join(dest, 'sync.sh'), 'utf8')).toContain('v1');
    expect(statSync(join(dest, 'sync.sh')).mode & 0o111).not.toBe(0);
    writeFileSync(src, '#!/bin/sh\necho v2\n');
    installRecyclarrScript(src, dest);
    expect(readFileSync(join(dest, 'sync.sh'), 'utf8')).toContain('v2');
  });

  it('sem script (dev/testes) não faz nada', () => {
    expect(installRecyclarrScript(undefined, tmp())).toBe(false);
    expect(installRecyclarrScript('/nao/existe.sh', tmp())).toBe(false);
  });
});

describe('chownTree', () => {
  it('não segue links simbólicos (nem ciclos) e só altera o que tem outro dono', () => {
    const root = tmp();
    const outside = tmp();
    writeFileSync(join(outside, 'biblioteca.mkv'), 'x');
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'sub', 'a.conf'), 'x');
    symlinkSync(outside, join(root, 'link-para-fora'));
    symlinkSync(root, join(root, 'sub', 'ciclo'));
    const me = { uid: process.getuid!(), gid: process.getgid!() };
    // já tudo com o dono certo: não altera nada e termina (sem seguir o ciclo)
    expect(chownTree(root, me.uid, me.gid)).toBe(0);
  });
});
