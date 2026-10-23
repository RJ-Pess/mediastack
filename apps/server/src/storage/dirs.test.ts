import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureDirs, physicalPath } from './dirs.js';

const mount = () => mkdtempSync(join(tmpdir(), 'ms-data-'));

describe('ensureDirs', () => {
  it('cria as pastas pedidas dentro da raiz de dados e é idempotente', () => {
    const m = mount();
    expect(ensureDirs(m, ['/data/series/ativas', '/data/filmes'])).toEqual([
      '/data/series/ativas',
      '/data/filmes',
    ]);
    expect(existsSync(join(m, 'series/ativas'))).toBe(true);
    expect(ensureDirs(m, ['/data/series/ativas'])).toEqual([]);
  });

  it('recusa caminhos fora de /data, incluindo escapes com ..', () => {
    const m = mount();
    expect(() => ensureDirs(m, ['/etc/passwd.d'])).toThrow(/dentro de \/data/);
    expect(() => ensureDirs(m, ['/data/../etc'])).toThrow(/dentro de \/data/);
    expect(() => ensureDirs(m, ['relativo/x'])).toThrow(/dentro de \/data/);
    expect(existsSync(join(m, '..', 'etc'))).toBe(false);
  });

  it('traduz o caminho do container para o do MediaStack', () => {
    expect(physicalPath('/mnt/x', '/data/media/tv')).toBe('/mnt/x/media/tv');
    expect(physicalPath('/data', '/data/media/tv')).toBe('/data/media/tv');
  });
});
