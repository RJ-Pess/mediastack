import { describe, expect, it } from 'vitest';
import { deriveDesired, diffLeaves } from './adopt.js';
import type { Ctx } from './plan/ctx.js';

interface Fake {
  tvCategory?: string;
  profiles?: string[];
  naming?: string;
}

/** Instalação existente simulada (só leitura). */
function existing(f: Fake = {}) {
  const arr = (extra: Record<string, unknown>) => ({
    get: async (path: string) => {
      if (path === 'rootfolder') return [{ path: extra.root }, { path: `${extra.root}-extra` }];
      if (path === 'downloadclient') {
        return [
          { name: 'qbit do utilizador', implementation: 'QBittorrent', fields: [extra.field] },
        ];
      }
      if (path === 'qualityprofile')
        return (f.profiles ?? ['Any', 'HD-1080p']).map((name) => ({ name }));
      if (path === 'config/naming') return { standardMovieFormat: f.naming ?? '{Movie Title}' };
      if (path === 'config/host') return { backupInterval: 3, backupRetention: 10 };
      throw new Error(`inesperado: ${path}`);
    },
  });
  return {
    sonarr: arr({ root: '/tv', field: { name: 'tvCategory', value: f.tvCategory ?? 'series' } }),
    radarr: arr({ root: '/filmes', field: { name: 'movieCategory', value: 'cinema' } }),
    qbit: {
      getPrefs: async () => ({
        dl_limit: 2048 * 1024,
        up_limit: 0,
        max_ratio_enabled: true,
        max_ratio: 1.5,
        save_path: '/dl',
      }),
      getCategories: async () => ({
        series: { name: 'series', savePath: '/downloads/torrents/series' },
      }),
    },
    bazarr: {
      getProfiles: async () => [{ items: [{ language: 'pt' }, { language: 'es' }] }],
      getLanguages: async () => [],
    },
  } as unknown as Ctx;
}

describe('deriveDesired', () => {
  it('converte uma instalação existente em estado desejado', async () => {
    const { desired, notes } = await deriveDesired(existing());
    expect(desired.storage).toMatchObject({
      tvRoot: '/tv',
      extraTvRoots: ['/tv-extra'],
      moviesRoot: '/filmes',
    });
    expect(desired.downloads).toMatchObject({
      torrentsRoot: '/downloads/torrents',
      categories: { tv: 'series', movies: 'cinema' },
      downKiBps: 2048,
      upKiBps: 0,
      seedRatio: 1.5,
    });
    expect(desired.subtitles.languages).toEqual(['pt', 'es']);
    expect(desired.backups).toEqual({ intervalDays: 3, retentionDays: 10 });
    expect(notes.join(' ')).toContain('notificações existentes não são tocadas');
  });

  it('sem perfis TRaSH nem preset de nomes: não mexe em qualidade nem nomes', async () => {
    const { desired } = await deriveDesired(existing());
    expect(desired.quality.profile).toBe('keep');
    expect(desired.naming.scheme).toBe('keep');
  });

  it('reconhece perfis TRaSH e o preset de nomes Jellyfin', async () => {
    const { desired } = await deriveDesired(
      existing({
        profiles: ['HD Bluray + WEB', 'UHD Bluray + WEB'],
        naming: '{Movie CleanTitle} [tmdbid-{TmdbId}]',
      }),
    );
    expect(desired.quality.profile).toBe('both');
    expect(desired.naming.scheme).toBe('jellyfin');
  });

  it('não falha se um serviço não responder: avisa nas notas', async () => {
    const ctx = existing();
    (ctx as unknown as { bazarr: unknown }).bazarr = {
      getProfiles: async () => {
        throw new Error('ECONNREFUSED');
      },
      getLanguages: async () => {
        throw new Error('ECONNREFUSED');
      },
    };
    const { notes } = await deriveDesired(ctx);
    expect(notes.some((n) => n.includes('Bazarr') && n.includes('ECONNREFUSED'))).toBe(true);
  });
});

describe('diffLeaves', () => {
  it('lista só os valores que mudam, com o caminho completo', () => {
    expect(
      diffLeaves({ a: { b: 1, c: [1, 2] }, d: 'x' }, { a: { b: 2, c: [1, 2] }, d: 'x' }),
    ).toEqual([{ path: 'a.b', from: 1, to: 2 }]);
    expect(diffLeaves({ l: ['a'] }, { l: ['a', 'b'] })).toEqual([
      { path: 'l', from: ['a'], to: ['a', 'b'] },
    ]);
  });
});

describe('adoptSchema', () => {
  it('aceita só os serviços que o utilizador tem', async () => {
    const { adoptSchema } = await import('./app.js');
    const ok = adoptSchema.safeParse({ services: { sonarr: { url: 'http://x:8989', key: 'k' } } });
    expect(ok.success).toBe(true);
    expect(
      adoptSchema.safeParse({ services: { sonarr: { url: 'ftp://x', key: 'k' } } }).success,
    ).toBe(false);
    expect(
      adoptSchema.safeParse({ services: { desconhecido: { url: 'http://x', key: 'k' } } }).success,
    ).toBe(false);
  });
});
