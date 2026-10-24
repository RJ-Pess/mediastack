import type { Ctx } from '../plan/ctx.js';
import type { SeerrClient } from '../reconcile/seerr.js';

const TMDB_IMG = 'https://image.tmdb.org/t/p/w342';

export type MediaType = 'movie' | 'tv';

export interface DiscoverItem {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: string;
  poster: string | null;
  rating: number | null;
  genreIds: number[];
  /** 1 desconhecido, 2 pendente, 3 a processar, 4 parcial, 5 disponível (estados do Seerr) */
  mediaStatus: number;
}

interface SeerrResult {
  id: number;
  mediaType?: string;
  title?: string;
  name?: string;
  releaseDate?: string;
  firstAirDate?: string;
  posterPath?: string;
  voteAverage?: number;
  genreIds?: number[];
  mediaInfo?: { status: number };
}
interface SeerrPage {
  page: number;
  totalPages: number;
  results: SeerrResult[];
}

export const toItem = (x: SeerrResult, fallbackType?: MediaType): DiscoverItem | null => {
  const mediaType = (x.mediaType ?? fallbackType) as MediaType | undefined;
  if (mediaType !== 'movie' && mediaType !== 'tv') return null; // ignora pessoas, coleções…
  return {
    tmdbId: x.id,
    mediaType,
    title: x.title ?? x.name ?? '',
    year: (x.releaseDate ?? x.firstAirDate ?? '').slice(0, 4),
    poster: x.posterPath ? `${TMDB_IMG}${x.posterPath}` : null,
    rating: x.voteAverage ? Math.round(x.voteAverage * 10) / 10 : null,
    genreIds: x.genreIds ?? [],
    mediaStatus: x.mediaInfo?.status ?? 1,
  };
};

/** "Já tenho": parcial (4) ou disponível (5) no Seerr. */
const owned = (i: DiscoverItem) => i.mediaStatus >= 4;

export interface Filters {
  type: MediaType;
  genre?: number;
  yearFrom?: number;
  yearTo?: number;
  sort: 'popular' | 'rating' | 'newest';
  page: number;
  hideOwned: boolean;
  /** Idioma dos títulos e géneros (ex.: pt-PT); vem da UI. */
  language?: string;
}

/** Explorar com filtros (uma página do Seerr/TMDB). */
export async function discover(
  seerr: SeerrClient,
  f: Filters,
  dismissed: Set<string>,
): Promise<{ items: DiscoverItem[]; page: number; totalPages: number }> {
  const q = new URLSearchParams({ page: String(f.page) });
  if (f.language) q.set('language', f.language);
  const sortBy = {
    popular: 'popularity.desc',
    rating: 'vote_average.desc',
    newest: f.type === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc',
  }[f.sort];
  q.set('sortBy', sortBy);
  if (f.genre) q.set('genre', String(f.genre));
  const [gte, lte] =
    f.type === 'movie'
      ? ['primaryReleaseDateGte', 'primaryReleaseDateLte']
      : ['firstAirDateGte', 'firstAirDateLte'];
  if (f.yearFrom) q.set(gte!, `${f.yearFrom}-01-01`);
  if (f.yearTo) q.set(lte!, `${f.yearTo}-12-31`);
  // Ordenar por nota sem um mínimo de votos traz títulos obscuros com uma só avaliação de 10.
  if (f.sort === 'rating') q.set('voteCountGte', '200');
  const page = await seerr.get<SeerrPage>(`discover/${f.type === 'movie' ? 'movies' : 'tv'}?${q}`);
  const items = page.results
    .map((r) => toItem(r, f.type))
    .filter((i): i is DiscoverItem => i !== null)
    .filter((i) => !dismissed.has(`${i.mediaType}:${i.tmdbId}`))
    .filter((i) => !f.hideOwned || !owned(i));
  return { items, page: page.page, totalPages: page.totalPages };
}

export interface DiscoverRow {
  id: 'similar' | 'trending' | 'upcoming-movies' | 'upcoming-tv';
  items: DiscoverItem[];
}

interface LibraryMovie {
  tmdbId?: number;
  added?: string;
  hasFile: boolean;
}

/**
 * Filas do Descobrir. "Parecido com a tua biblioteca" usa as recomendações do TMDB para os
 * filmes adicionados mais recentemente (sem os que já tens nem os que dispensaste).
 */
export async function discoverRows(
  ctx: Ctx,
  seerr: SeerrClient,
  dismissed: Set<string>,
  hideOwned: boolean,
  language?: string,
): Promise<DiscoverRow[]> {
  const lang = language ? `&language=${encodeURIComponent(language)}` : '';
  const clean = (list: (DiscoverItem | null)[]) => {
    const seen = new Set<string>();
    return list
      .filter((i): i is DiscoverItem => i !== null)
      .filter((i) => {
        const k = `${i.mediaType}:${i.tmdbId}`;
        if (seen.has(k) || dismissed.has(k)) return false;
        seen.add(k);
        return !hideOwned || !owned(i);
      });
  };
  const page = (path: string, type?: MediaType) =>
    seerr
      .get<SeerrPage>(path)
      .then((p) => p.results.map((r) => toItem(r, type)))
      .catch(() => [] as (DiscoverItem | null)[]);

  const library = await ctx.radarr.get<LibraryMovie[]>('movie').catch(() => [] as LibraryMovie[]);
  const seeds = library
    .filter((m) => m.tmdbId)
    .sort((a, b) => (b.added ?? '').localeCompare(a.added ?? ''))
    .slice(0, 4);
  const [trending, upMovies, upTv, ...recs] = await Promise.all([
    page(`discover/trending?page=1${lang}`),
    page(`discover/movies/upcoming?page=1${lang}`, 'movie'),
    page(`discover/tv/upcoming?page=1${lang}`, 'tv'),
    ...seeds.map((m) => page(`movie/${m.tmdbId}/recommendations?page=1${lang}`, 'movie')),
  ]);
  // Intercala as recomendações de cada filme, para a fila não ser dominada por um só.
  const interleaved: (DiscoverItem | null)[] = [];
  for (let i = 0; i < 20; i++) for (const r of recs) if (r[i]) interleaved.push(r[i]!);

  const rows: DiscoverRow[] = [
    { id: 'similar', items: clean(interleaved).slice(0, 20) },
    { id: 'trending', items: clean(trending ?? []) },
    { id: 'upcoming-movies', items: clean(upMovies ?? []) },
    { id: 'upcoming-tv', items: clean(upTv ?? []) },
  ];
  return rows.filter((r) => r.items.length > 0);
}

export async function genres(seerr: SeerrClient, type: MediaType, language?: string) {
  const lang = language ? `?language=${encodeURIComponent(language)}` : '';
  return seerr.get<{ id: number; name: string }[]>(`genres/${type}${lang}`);
}
