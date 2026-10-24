import { describe, expect, it } from 'vitest';
import type { Ctx } from '../plan/ctx.js';
import { bulk, history } from './library-ops.js';

function fake() {
  const calls: string[] = [];
  const client = (name: string, records: unknown[] = []) => ({
    request: async (method: string, path: string, body: unknown) =>
      void calls.push(`${name} ${method} ${path} ${JSON.stringify(body)}`),
    get: async () => ({ records }),
  });
  const ctx = {
    radarr: client('radarr', [
      { date: '2026-10-02', eventType: 'grabbed', sourceTitle: 'A.2020', movie: { title: 'A' } },
    ]),
    sonarr: client('sonarr', [
      {
        date: '2026-10-03',
        eventType: 'downloadFolderImported',
        sourceTitle: 'X.S01E02',
        series: { title: 'X' },
        episode: { seasonNumber: 1, episodeNumber: 2, title: 'e' },
      },
    ]),
  } as unknown as Ctx;
  return { ctx, calls };
}

describe('bulk', () => {
  it('monitorizar usa os editores do Radarr e do Sonarr numa só chamada cada', async () => {
    const { ctx, calls } = fake();
    await bulk(ctx, 'unmonitor', [
      { kind: 'movie', id: 1 },
      { kind: 'movie', id: 2 },
      { kind: 'series', id: 9 },
    ]);
    expect(calls).toEqual([
      'radarr PUT movie/editor {"movieIds":[1,2],"monitored":false}',
      'sonarr PUT series/editor {"seriesIds":[9],"monitored":false}',
    ]);
  });

  it('procurar: um comando para os filmes, um por série', async () => {
    const { ctx, calls } = fake();
    await bulk(ctx, 'search', [
      { kind: 'movie', id: 1 },
      { kind: 'series', id: 9 },
      { kind: 'series', id: 10 },
    ]);
    expect(calls).toEqual([
      'radarr POST command {"name":"MoviesSearch","movieIds":[1]}',
      'sonarr POST command {"name":"SeriesSearch","seriesId":9}',
      'sonarr POST command {"name":"SeriesSearch","seriesId":10}',
    ]);
  });
});

describe('history', () => {
  it('junta os dois serviços, normaliza o evento e ordena por data', async () => {
    const { ctx } = fake();
    expect(await history(ctx)).toEqual([
      {
        service: 'sonarr',
        date: '2026-10-03',
        event: 'imported',
        title: 'X · S01E02',
        sourceTitle: 'X.S01E02',
      },
      {
        service: 'radarr',
        date: '2026-10-02',
        event: 'grabbed',
        title: 'A',
        sourceTitle: 'A.2020',
      },
    ]);
  });
});
