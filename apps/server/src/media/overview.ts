import { readFileSync, statfsSync } from 'node:fs';
import type { Ctx } from '../plan/ctx.js';

/** Poster com um estado opcional, usado nas filas do Início. */
export interface PosterItem {
  key: string;
  kind: 'movie' | 'series';
  title: string;
  year: number | null;
  poster: string | null;
  /** Linha secundária (ex.: S01E02, "falta"). */
  detail?: string;
  badge?: 'downloading' | 'missing' | 'available';
  progress?: number;
  date?: string;
}

export interface Overview {
  counts: {
    downloading: number;
    queued: number;
    missing: number;
    healthIssues: number;
    pendingRequests: number | null;
  };
  server: {
    cpuPct: number | null;
    memUsed: number | null;
    memTotal: number | null;
    diskUsed: number | null;
    diskTotal: number | null;
  };
  media: {
    movies: { total: number; downloaded: number; missing: number } | null;
    series: { total: number; episodes: number; episodesTotal: number } | null;
  };
  recent: PosterItem[];
  upcoming: PosterItem[];
}

interface ArrImage {
  coverType: string;
  remoteUrl?: string;
}
const poster = (images?: ArrImage[]) =>
  images?.find((i) => i.coverType === 'poster')?.remoteUrl ?? null;

interface Movie {
  id: number;
  title: string;
  year: number;
  images: ArrImage[];
  monitored: boolean;
  hasFile: boolean;
  isAvailable?: boolean;
  movieFile?: { dateAdded?: string };
}
interface Series {
  id: number;
  title: string;
  year: number;
  images: ArrImage[];
  statistics?: { episodeFileCount: number; episodeCount: number; totalEpisodeCount?: number };
}
interface HistoryRecord {
  date: string;
  movie?: Movie;
  series?: Series;
}
interface QueueRecord {
  title: string;
  size: number;
  sizeleft: number;
  movie?: Movie;
  series?: Series;
  episode?: { seasonNumber: number; episodeNumber: number };
}
interface MissingEpisode {
  seasonNumber: number;
  episodeNumber: number;
  series?: Series;
}

const DOWNLOADING = new Set(['downloading', 'stalledDL', 'metaDL', 'forcedDL', 'checkingDL']);
const QUEUED = new Set(['queuedDL']);
const episodeCode = (s: number, e: number) =>
  `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;

/** Uso de CPU do host: duas leituras de /proc/stat com 200 ms de intervalo. */
async function cpuPercent(): Promise<number | null> {
  const read = () => {
    const line = readFileSync('/proc/stat', 'utf8').split('\n')[0]!;
    const n = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = (n[3] ?? 0) + (n[4] ?? 0);
    return { idle, total: n.reduce((a, b) => a + b, 0) };
  };
  try {
    const a = read();
    await new Promise((r) => setTimeout(r, 200));
    const b = read();
    const total = b.total - a.total;
    return total > 0 ? Math.round((1 - (b.idle - a.idle) / total) * 1000) / 10 : null;
  } catch {
    return null; // fora de Linux (desenvolvimento no Mac)
  }
}

function memory(): { used: number; total: number } | null {
  try {
    const info = readFileSync('/proc/meminfo', 'utf8');
    const kb = (k: string) =>
      Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(info)?.[1] ?? 0) * 1024;
    const total = kb('MemTotal');
    return total ? { total, used: total - kb('MemAvailable') } : null;
  } catch {
    return null;
  }
}

function disk(path: string): { used: number; total: number } | null {
  try {
    const s = statfsSync(path);
    const total = s.blocks * s.bsize;
    return { total, used: total - s.bavail * s.bsize };
  } catch {
    return null;
  }
}

/**
 * Tudo o que o Início mostra, numa chamada. Cada fonte é independente: um serviço em baixo
 * deixa a parte dele vazia (null) em vez de partir a página.
 */
export async function getOverview(ctx: Ctx): Promise<Overview> {
  const soft = <T>(p: Promise<T>) => p.catch(() => null);
  const [
    movies,
    series,
    torrents,
    rHistory,
    sHistory,
    rQueue,
    sQueue,
    sMissing,
    healths,
    reqCount,
    cpu,
  ] = await Promise.all([
    soft(ctx.radarr.get<Movie[]>('movie')),
    soft(ctx.sonarr.get<Series[]>('series')),
    soft(ctx.qbit.getTorrents()),
    soft(
      ctx.radarr.get<{ records: HistoryRecord[] }>(
        'history?pageSize=30&eventType=3&includeMovie=true&sortKey=date&sortDirection=descending',
      ),
    ),
    soft(
      ctx.sonarr.get<{ records: HistoryRecord[] }>(
        'history?pageSize=30&eventType=3&includeSeries=true&sortKey=date&sortDirection=descending',
      ),
    ),
    soft(ctx.radarr.get<{ records: QueueRecord[] }>('queue?pageSize=20&includeMovie=true')),
    soft(
      ctx.sonarr.get<{ records: QueueRecord[] }>(
        'queue?pageSize=20&includeSeries=true&includeEpisode=true',
      ),
    ),
    soft(
      ctx.sonarr.get<{ totalRecords: number; records: MissingEpisode[] }>(
        'wanted/missing?pageSize=10&includeSeries=true&sortKey=airDateUtc&sortDirection=descending',
      ),
    ),
    Promise.all(
      [ctx.sonarr, ctx.radarr, ctx.prowlarr].map((c) =>
        c.get<{ type: string }[]>('health').catch(() => []),
      ),
    ),
    ctx.seerr ? soft(ctx.seerr.get<{ pending: number }>('request/count')) : Promise.resolve(null),
    cpuPercent(),
  ]);

  const mem = memory();
  const dsk = disk(ctx.dataMount);
  const missingMovies = (movies ?? []).filter(
    (m) => m.monitored && !m.hasFile && m.isAvailable !== false,
  );

  // Acabado de adicionar: importações recentes do Radarr e do Sonarr (uma por título).
  const recentRaw: PosterItem[] = [
    ...(rHistory?.records ?? []).flatMap((r) =>
      r.movie
        ? [
            {
              key: `movie:${r.movie.id}`,
              kind: 'movie' as const,
              title: r.movie.title,
              year: r.movie.year,
              poster: poster(r.movie.images),
              badge: 'available' as const,
              date: r.date,
            },
          ]
        : [],
    ),
    ...(sHistory?.records ?? []).flatMap((r) =>
      r.series
        ? [
            {
              key: `series:${r.series.id}`,
              kind: 'series' as const,
              title: r.series.title,
              year: r.series.year,
              poster: poster(r.series.images),
              badge: 'available' as const,
              date: r.date,
            },
          ]
        : [],
    ),
  ].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const seen = new Set<string>();
  const recent = recentRaw.filter((p) => !seen.has(p.key) && seen.add(p.key)).slice(0, 10);

  // A caminho: primeiro o que está a descarregar, depois o que falta.
  const upcoming: PosterItem[] = [];
  const add = (p: PosterItem) => {
    if (!upcoming.some((u) => u.key === p.key)) upcoming.push(p);
  };
  for (const q of rQueue?.records ?? []) {
    if (q.movie) {
      add({
        key: `movie:${q.movie.id}`,
        kind: 'movie',
        title: q.movie.title,
        year: q.movie.year,
        poster: poster(q.movie.images),
        badge: 'downloading',
        progress: q.size ? 1 - q.sizeleft / q.size : 0,
      });
    }
  }
  for (const q of sQueue?.records ?? []) {
    if (q.series) {
      add({
        key: `series:${q.series.id}`,
        kind: 'series',
        title: q.series.title,
        year: q.series.year,
        poster: poster(q.series.images),
        detail: q.episode
          ? episodeCode(q.episode.seasonNumber, q.episode.episodeNumber)
          : undefined,
        badge: 'downloading',
        progress: q.size ? 1 - q.sizeleft / q.size : 0,
      });
    }
  }
  for (const m of missingMovies.slice(0, 10)) {
    add({
      key: `movie:${m.id}`,
      kind: 'movie',
      title: m.title,
      year: m.year,
      poster: poster(m.images),
      badge: 'missing',
    });
  }
  for (const e of sMissing?.records ?? []) {
    if (e.series) {
      add({
        key: `series:${e.series.id}`,
        kind: 'series',
        title: e.series.title,
        year: e.series.year,
        poster: poster(e.series.images),
        detail: episodeCode(e.seasonNumber, e.episodeNumber),
        badge: 'missing',
      });
    }
  }

  const episodes = (series ?? []).reduce((n, s) => n + (s.statistics?.episodeFileCount ?? 0), 0);
  const episodesTotal = (series ?? []).reduce((n, s) => n + (s.statistics?.episodeCount ?? 0), 0);

  return {
    counts: {
      downloading: (torrents ?? []).filter((t) => DOWNLOADING.has(t.state)).length,
      queued: (torrents ?? []).filter((t) => QUEUED.has(t.state)).length,
      missing: missingMovies.length + (sMissing?.totalRecords ?? 0),
      healthIssues: healths.flat().length,
      pendingRequests: reqCount?.pending ?? null,
    },
    server: {
      cpuPct: cpu,
      memUsed: mem?.used ?? null,
      memTotal: mem?.total ?? null,
      diskUsed: dsk?.used ?? null,
      diskTotal: dsk?.total ?? null,
    },
    media: {
      movies: movies
        ? {
            total: movies.length,
            downloaded: movies.filter((m) => m.hasFile).length,
            missing: missingMovies.length,
          }
        : null,
      series: series ? { total: series.length, episodes, episodesTotal } : null,
    },
    recent,
    upcoming: upcoming.slice(0, 10),
  };
}
