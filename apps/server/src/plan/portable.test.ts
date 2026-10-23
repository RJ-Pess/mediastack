import { describe, expect, it } from 'vitest';
import { defaultDesired } from './desired.js';
import { exportYaml, importYaml } from './portable.js';

describe('export/import YAML', () => {
  it('ida e volta mantém o estado', () => {
    const d = defaultDesired();
    d.quality.profile = '4k';
    d.subtitles.languages = ['pt', 'en', 'es'];
    d.storage.extraMoviesRoots = ['/data/media/filmes-bons'];
    const { desired, secrets } = importYaml(exportYaml(d));
    expect(desired).toEqual(d);
    expect(secrets).toEqual({});
  });

  it('só inclui segredos (cifrados) quando pedido', () => {
    const d = defaultDesired();
    expect(exportYaml(d)).not.toContain('secrets:');
    const yaml = exportYaml(d, { 'seerr.apikey': 'blob-cifrado' });
    expect(yaml).toContain('blob-cifrado');
    expect(importYaml(yaml).secrets).toEqual({ 'seerr.apikey': 'blob-cifrado' });
  });

  it('exports antigos (sem secções novas) usam os valores por omissão', () => {
    const yaml = 'mediastack:\n  version: 1\ndesired:\n  quality:\n    profile: both\n';
    const { desired } = importYaml(yaml);
    expect(desired.quality.profile).toBe('both');
    expect(desired.backups).toEqual(defaultDesired().backups);
  });

  it('rejeita lixo e valores inválidos com mensagens claras', () => {
    expect(() => importYaml('isto: não é um export')).toThrow(/não é um export/);
    expect(() => importYaml(': : :')).toThrow(/YAML inválido/);
    expect(() =>
      importYaml('mediastack:\n  version: 1\ndesired:\n  quality:\n    profile: 8k\n'),
    ).toThrow(/quality\.profile/);
  });
});
