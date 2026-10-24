import { describe, expect, it } from 'vitest';
import type { Ctx } from '../plan/ctx.js';
import type { SeerrClient } from '../reconcile/seerr.js';
import { discover, discoverRows, toItem } from './discover.js';

const r = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Filme ${id}`,
  releaseDate: '2024-05-01',
  posterPath: `/p${id}.jpg`,
  voteAverage: 7.25,
  genreIds: [18],
  ...extra,
});

function fakeSeerr(pages: Record<string, unknown>) {
  const calls: string[] = [];
  return {
    calls,
    seerr: {
      get: async (path: string) => {
        calls.push(path);
        const key = Object.keys(pages).find((k) => path.startsWith(k));
        if (!key) throw new Error(`inesperado: ${path}`);
        return pages[key];
      },
    } as unknown as SeerrClient,
  };
}

describe('toItem', () => {
  it('normaliza resultados e ignora pessoas', () => {
    expect(toItem(r(1), 'movie')).toEqual({
      tmdbId: 1,
      mediaType: 'movie',
      title: 'Filme 1',
      year: '2024',
      poster: 'https://image.tmdb.org/t/p/w342/p1.jpg',
      rating: 7.3,
      genreIds: [18],
      mediaStatus: 1,
    });
    expect(toItem({ id: 9, mediaType: 'person', name: 'Alguém' })).toBeNull();
  });
});

describe('discover', () => {
  it('traduz os filtros para a API do Seerr e esconde o que já tens e o que dispensaste', async () => {
    const { seerr, calls } = fakeSeerr({
      'discover/movies': {
        page: 1,
        totalPages: 3,
        results: [r(1), r(2, { mediaInfo: { status: 5 } }), r(3)],
      },
    });
    const out = await discover(
      seerr,
      {
        type: 'movie',
        genre: 18,
        yearFrom: 2000,
        yearTo: 2010,
        sort: 'rating',
        page: 1,
        hideOwned: true,
      },
      new Set(['movie:3']),
    );
    expect(out.items.map((i) => i.tmdbId)).toEqual([1]);
    expect(out.totalPages).toBe(3);
    const q = new URLSearchParams(calls[0]!.split('?')[1]);
    expect(Object.fromEntries(q)).toMatchObject({
      sortBy: 'vote_average.desc',
      genre: '18',
      primaryReleaseDateGte: '2000-01-01',
      primaryReleaseDateLte: '2010-12-31',
      voteCountGte: '200',
    });
  });

  it('séries usam as datas de estreia', async () => {
    const { seerr, calls } = fakeSeerr({ 'discover/tv': { page: 1, totalPages: 1, results: [] } });
    await discover(
      seerr,
      { type: 'tv', yearFrom: 2020, sort: 'newest', page: 2, hideOwned: false },
      new Set(),
    );
    expect(calls[0]).toContain('firstAirDateGte=2020-01-01');
    expect(calls[0]).toContain('sortBy=first_air_date.desc');
    expect(calls[0]).toContain('page=2');
  });
});

describe('discoverRows', () => {
  it('recomendações a partir dos filmes mais recentes, intercaladas e sem repetidos', async () => {
    const { seerr } = fakeSeerr({
      'discover/trending': { page: 1, totalPages: 1, results: [r(10, { mediaType: 'movie' })] },
      'discover/movies/upcoming': { page: 1, totalPages: 1, results: [] },
      'discover/tv/upcoming': { page: 1, totalPages: 1, results: [] },
      'movie/100/recommendations': { page: 1, totalPages: 1, results: [r(1), r(2)] },
      'movie/200/recommendations': { page: 1, totalPages: 1, results: [r(3), r(1)] },
    });
    const ctx = {
      radarr: {
        get: async () => [
          { tmdbId: 100, added: '2026-10-01', hasFile: true },
          { tmdbId: 200, added: '2026-10-05', hasFile: true },
        ],
      },
    } as unknown as Ctx;
    const rows = await discoverRows(ctx, seerr, new Set(), false);
    expect(rows.map((x) => x.id)).toEqual(['similar', 'trending']); // filas vazias não aparecem
    // 200 é o mais recente: as recomendações dele vêm primeiro, intercaladas com as do 100
    expect(rows[0]!.items.map((i) => i.tmdbId)).toEqual([3, 1, 2]);
  });
});
