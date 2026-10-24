import type { Ctx } from '../plan/ctx.js';

export interface LibraryRef {
  kind: 'movie' | 'series';
  id: number;
}

export type BulkAction = 'search' | 'monitor' | 'unmonitor';

/** Ações em lote na biblioteca, pelas APIs nativas do Radarr (filmes) e do Sonarr (séries). */
export async function bulk(ctx: Ctx, action: BulkAction, items: LibraryRef[]): Promise<void> {
  const movieIds = items.filter((i) => i.kind === 'movie').map((i) => i.id);
  const seriesIds = items.filter((i) => i.kind === 'series').map((i) => i.id);
  if (action === 'search') {
    if (movieIds.length)
      await ctx.radarr.request('POST', 'command', { name: 'MoviesSearch', movieIds });
    // O Sonarr só procura uma série por comando.
    for (const seriesId of seriesIds) {
      await ctx.sonarr.request('POST', 'command', { name: 'SeriesSearch', seriesId });
    }
    return;
  }
  const monitored = action === 'monitor';
  if (movieIds.length) await ctx.radarr.request('PUT', 'movie/editor', { movieIds, monitored });
  if (seriesIds.length) await ctx.sonarr.request('PUT', 'series/editor', { seriesIds, monitored });
}

export interface HistoryEntry {
  service: 'sonarr' | 'radarr';
  date: string;
  event: 'grabbed' | 'imported' | 'failed' | 'deleted' | 'renamed' | 'other';
  title: string;
  sourceTitle: string;
}

interface RawHistory {
  date: string;
  eventType: string;
  sourceTitle: string;
  movie?: { title: string };
  series?: { title: string };
  episode?: { seasonNumber: number; episodeNumber: number; title: string };
}

const EVENT: Record<string, HistoryEntry['event']> = {
  grabbed: 'grabbed',
  downloadFolderImported: 'imported',
  episodeFileImported: 'imported',
  movieFileImported: 'imported',
  downloadFailed: 'failed',
  movieFileDeleted: 'deleted',
  episodeFileDeleted: 'deleted',
  movieFileRenamed: 'renamed',
  episodeFileRenamed: 'renamed',
};

/** Histórico recente dos dois *arr, junto e por data. */
export async function history(ctx: Ctx, size = 50): Promise<HistoryEntry[]> {
  const q = `history?pageSize=${size}&sortKey=date&sortDirection=descending`;
  const [r, s] = await Promise.all([
    ctx.radarr
      .get<{ records: RawHistory[] }>(`${q}&includeMovie=true`)
      .catch(() => ({ records: [] })),
    ctx.sonarr
      .get<{ records: RawHistory[] }>(`${q}&includeSeries=true&includeEpisode=true`)
      .catch(() => ({ records: [] })),
  ]);
  const map = (service: HistoryEntry['service'], h: RawHistory): HistoryEntry => ({
    service,
    date: h.date,
    event: EVENT[h.eventType] ?? 'other',
    title:
      h.movie?.title ??
      (h.series
        ? `${h.series.title}${h.episode ? ` · S${String(h.episode.seasonNumber).padStart(2, '0')}E${String(h.episode.episodeNumber).padStart(2, '0')}` : ''}`
        : h.sourceTitle),
    sourceTitle: h.sourceTitle,
  });
  return [...r.records.map((h) => map('radarr', h)), ...s.records.map((h) => map('sonarr', h))]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, size);
}

export interface BlocklistEntry {
  service: 'sonarr' | 'radarr';
  id: number;
  date: string;
  title: string;
  sourceTitle: string;
  message?: string;
}

/** Releases bloqueados (falharam ou foram rejeitados) — podem ser desbloqueados. */
export async function blocklist(ctx: Ctx): Promise<BlocklistEntry[]> {
  type Raw = {
    id: number;
    date: string;
    sourceTitle: string;
    message?: string;
    movie?: { title: string };
    series?: { title: string };
  };
  const [r, s] = await Promise.all([
    ctx.radarr
      .get<{ records: Raw[] }>('blocklist?pageSize=100&includeMovie=true')
      .catch(() => ({ records: [] })),
    ctx.sonarr
      .get<{ records: Raw[] }>('blocklist?pageSize=100&includeSeries=true')
      .catch(() => ({ records: [] })),
  ]);
  const map = (service: BlocklistEntry['service'], b: Raw): BlocklistEntry => ({
    service,
    id: b.id,
    date: b.date,
    title: b.movie?.title ?? b.series?.title ?? b.sourceTitle,
    sourceTitle: b.sourceTitle,
    message: b.message,
  });
  return [
    ...r.records.map((b) => map('radarr', b)),
    ...s.records.map((b) => map('sonarr', b)),
  ].sort((a, b) => b.date.localeCompare(a.date));
}

export async function unblock(ctx: Ctx, service: 'sonarr' | 'radarr', id: number): Promise<void> {
  await ctx[service].request('DELETE', `blocklist/${id}`);
}

export interface WantedItem {
  kind: 'movie' | 'episode';
  title: string;
  detail?: string;
  date?: string;
}

/** O que está monitorizado mas ainda não tem ficheiro. */
export async function wanted(ctx: Ctx): Promise<WantedItem[]> {
  type Movie = {
    title: string;
    year: number;
    monitored: boolean;
    hasFile: boolean;
    isAvailable?: boolean;
    digitalRelease?: string;
    inCinemas?: string;
  };
  type Ep = {
    seasonNumber: number;
    episodeNumber: number;
    title: string;
    airDateUtc?: string;
    series?: { title: string };
  };
  const [movies, eps] = await Promise.all([
    ctx.radarr.get<Movie[]>('movie').catch(() => [] as Movie[]),
    ctx.sonarr
      .get<{ records: Ep[] }>(
        'wanted/missing?pageSize=50&includeSeries=true&sortKey=airDateUtc&sortDirection=descending',
      )
      .catch(() => ({ records: [] as Ep[] })),
  ]);
  return [
    ...movies
      .filter((m) => m.monitored && !m.hasFile && m.isAvailable !== false)
      .map((m): WantedItem => ({
        kind: 'movie',
        title: m.title,
        detail: String(m.year),
        date: m.digitalRelease ?? m.inCinemas,
      })),
    ...eps.records.map((e): WantedItem => ({
      kind: 'episode',
      title: e.series?.title ?? e.title,
      detail: `S${String(e.seasonNumber).padStart(2, '0')}E${String(e.episodeNumber).padStart(2, '0')} · ${e.title}`,
      date: e.airDateUtc,
    })),
  ];
}
