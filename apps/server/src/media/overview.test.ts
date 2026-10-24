import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Ctx } from '../plan/ctx.js';
import { getOverview } from './overview.js';

const img = (n: string) => [{ coverType: 'poster', remoteUrl: `https://img/${n}.jpg` }];

function fakeCtx(opts: { sonarrDown?: boolean } = {}) {
  const radarr = {
    get: async (path: string) => {
      if (path === 'movie') {
        return [
          { id: 1, title: 'Filme A', year: 2020, images: img('a'), monitored: true, hasFile: true },
          {
            id: 2,
            title: 'Filme B',
            year: 2021,
            images: img('b'),
            monitored: true,
            hasFile: false,
          },
          {
            id: 3,
            title: 'Filme C',
            year: 2022,
            images: img('c'),
            monitored: false,
            hasFile: false,
          },
        ];
      }
      if (path.startsWith('history')) {
        return {
          records: [
            {
              date: '2026-10-20T10:00:00Z',
              movie: { id: 1, title: 'Filme A', year: 2020, images: img('a') },
            },
          ],
        };
      }
      if (path.startsWith('queue')) {
        return {
          records: [
            {
              title: 'x',
              size: 100,
              sizeleft: 25,
              movie: { id: 2, title: 'Filme B', year: 2021, images: img('b') },
            },
          ],
        };
      }
      if (path === 'health') return [{ type: 'warning' }];
      throw new Error(path);
    },
  };
  const sonarr = {
    get: async (path: string) => {
      if (opts.sonarrDown) throw new Error('ECONNREFUSED');
      if (path === 'series') {
        return [
          {
            id: 7,
            title: 'Série X',
            year: 2019,
            images: img('x'),
            statistics: { episodeFileCount: 5, episodeCount: 8 },
          },
        ];
      }
      if (path.startsWith('history')) {
        return {
          records: [
            {
              date: '2026-10-22T10:00:00Z',
              series: { id: 7, title: 'Série X', year: 2019, images: img('x') },
            },
          ],
        };
      }
      if (path.startsWith('queue')) return { records: [] };
      if (path.startsWith('wanted/missing')) {
        return {
          totalRecords: 3,
          records: [
            {
              seasonNumber: 1,
              episodeNumber: 6,
              series: { id: 7, title: 'Série X', year: 2019, images: img('x') },
            },
          ],
        };
      }
      if (path === 'health') return [];
      throw new Error(path);
    },
  };
  return {
    radarr,
    sonarr,
    prowlarr: { get: async () => [] },
    qbit: {
      getTorrents: async () => [
        { state: 'downloading' },
        { state: 'stalledDL' },
        { state: 'queuedDL' },
        { state: 'uploading' },
      ],
    },
    seerr: { get: async () => ({ pending: 4 }) },
    dataMount: mkdtempSync(join(tmpdir(), 'ms-ov-')),
  } as unknown as Ctx;
}

describe('getOverview', () => {
  it('junta contagens, filas e posters de todos os serviços', async () => {
    const o = await getOverview(fakeCtx());
    expect(o.counts).toEqual({
      downloading: 2,
      queued: 1,
      missing: 1 + 3,
      healthIssues: 1,
      pendingRequests: 4,
    });
    expect(o.media.movies).toEqual({ total: 3, downloaded: 1, missing: 1 });
    expect(o.media.series).toEqual({ total: 1, episodes: 5, episodesTotal: 8 });
    // mais recente primeiro
    expect(o.recent.map((r) => r.title)).toEqual(['Série X', 'Filme A']);
    // a descarregar antes do que falta; um título aparece uma só vez
    expect(o.upcoming.map((u) => [u.title, u.badge])).toEqual([
      ['Filme B', 'downloading'],
      ['Série X', 'missing'],
    ]);
    expect(o.upcoming[0]!.progress).toBeCloseTo(0.75);
    expect(o.upcoming[1]!.detail).toBe('S01E06');
    expect(o.server.diskTotal).toBeGreaterThan(0);
  });

  it('um serviço em baixo só deixa a parte dele vazia', async () => {
    const o = await getOverview(fakeCtx({ sonarrDown: true }));
    expect(o.media.series).toBeNull();
    expect(o.media.movies).not.toBeNull();
    expect(o.recent.map((r) => r.title)).toEqual(['Filme A']);
  });
});
