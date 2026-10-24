import type { Config } from '../config.js';
import type { Ctx } from '../plan/ctx.js';
import type { SeerrClient } from '../reconcile/seerr.js';

export interface ActivityItem {
  id: string;
  source: 'qbittorrent' | 'sonarr' | 'radarr';
  title: string;
  progress: number;
  downBps: number;
  etaSec: number | null;
  state: string;
  category?: string;
  hash?: string;
}

export interface CalendarItem {
  date: string;
  kind: 'episode' | 'movie';
  title: string;
  subtitle?: string;
  hasFile: boolean;
}

export interface LibraryItem {
  id: number;
  kind: 'movie' | 'series';
  title: string;
  year: number;
  poster: string | null;
  hasFile: boolean;
  sizeOnDisk: number;
  status: string;
  monitored: boolean;
}

interface ArrImage {
  coverType: string;
  remoteUrl?: string;
}
const poster = (images?: ArrImage[]) =>
  images?.find((i) => i.coverType === 'poster')?.remoteUrl ?? null;

const TMDB_IMG = 'https://image.tmdb.org/t/p/w342';
const TMDB_BACKDROP = 'https://image.tmdb.org/t/p/w780';

export async function getActivity(ctx: Ctx): Promise<ActivityItem[]> {
  const [torrents, sq, rq] = await Promise.all([
    ctx.qbit.getTorrents(),
    ctx.sonarr.get<{ records: QueueRecord[] }>('queue?pageSize=100'),
    ctx.radarr.get<{ records: QueueRecord[] }>('queue?pageSize=100'),
  ]);
  const items: ActivityItem[] = torrents.map((t) => ({
    id: `qbt:${t.hash}`,
    source: 'qbittorrent',
    title: t.name,
    progress: t.progress,
    downBps: t.dlspeed,
    etaSec: t.eta >= 8_640_000 ? null : t.eta,
    state: t.state,
    category: t.category,
    hash: t.hash,
  }));
  const known = new Set(torrents.map((t) => t.hash.toLowerCase()));
  for (const [source, q] of [
    ['sonarr', sq],
    ['radarr', rq],
  ] as const) {
    for (const r of q.records) {
      if (r.downloadId && known.has(r.downloadId.toLowerCase())) continue;
      items.push({
        id: `${source}:${r.id}`,
        source,
        title: r.title,
        progress: r.size ? 1 - r.sizeleft / r.size : 0,
        downBps: 0,
        etaSec: null,
        state: r.trackedDownloadState ?? r.status,
      });
    }
  }
  return items;
}

interface QueueRecord {
  id: number;
  title: string;
  size: number;
  sizeleft: number;
  status: string;
  trackedDownloadState?: string;
  downloadId?: string;
}

export async function getCalendar(ctx: Ctx, days = 21, from?: Date): Promise<CalendarItem[]> {
  const start = from ?? new Date();
  const end = new Date(start.getTime() + days * 86_400_000);
  const q = `start=${start.toISOString().slice(0, 10)}&end=${end.toISOString().slice(0, 10)}`;
  const [eps, movies] = await Promise.all([
    ctx.sonarr.get<
      {
        airDateUtc?: string;
        title: string;
        seasonNumber: number;
        episodeNumber: number;
        hasFile: boolean;
        series?: { title: string };
      }[]
    >(`calendar?${q}&includeSeries=true`),
    ctx.radarr.get<
      {
        title: string;
        digitalRelease?: string;
        physicalRelease?: string;
        inCinemas?: string;
        hasFile: boolean;
      }[]
    >(`calendar?${q}`),
  ]);
  const out: CalendarItem[] = [
    ...eps.flatMap((e) =>
      e.airDateUtc
        ? [
            {
              date: e.airDateUtc,
              kind: 'episode' as const,
              title: e.series?.title ?? e.title,
              subtitle: `S${String(e.seasonNumber).padStart(2, '0')}E${String(e.episodeNumber).padStart(2, '0')} · ${e.title}`,
              hasFile: e.hasFile,
            },
          ]
        : [],
    ),
    ...movies.flatMap((m) => {
      const date = m.digitalRelease ?? m.physicalRelease ?? m.inCinemas;
      return date ? [{ date, kind: 'movie' as const, title: m.title, hasFile: m.hasFile }] : [];
    }),
  ];
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function getLibrary(ctx: Ctx): Promise<LibraryItem[]> {
  const [series, movies] = await Promise.all([
    ctx.sonarr.get<
      {
        id: number;
        title: string;
        year: number;
        images: ArrImage[];
        status: string;
        monitored: boolean;
        statistics?: { sizeOnDisk: number; episodeFileCount: number };
      }[]
    >('series'),
    ctx.radarr.get<
      {
        id: number;
        title: string;
        year: number;
        images: ArrImage[];
        status: string;
        hasFile: boolean;
        sizeOnDisk: number;
        monitored: boolean;
      }[]
    >('movie'),
  ]);
  return [
    ...series.map((s): LibraryItem => ({
      id: s.id,
      kind: 'series',
      title: s.title,
      year: s.year,
      poster: poster(s.images),
      hasFile: (s.statistics?.episodeFileCount ?? 0) > 0,
      sizeOnDisk: s.statistics?.sizeOnDisk ?? 0,
      status: s.status,
      monitored: s.monitored,
    })),
    ...movies.map((m): LibraryItem => ({
      id: m.id,
      kind: 'movie',
      title: m.title,
      year: m.year,
      poster: poster(m.images),
      hasFile: m.hasFile,
      sizeOnDisk: m.sizeOnDisk,
      status: m.status,
      monitored: m.monitored,
    })),
  ].sort((a, b) => a.title.localeCompare(b.title, 'pt'));
}

export interface SearchResult {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: string;
  poster: string | null;
  /** 1 desconhecido, 2 pendente, 3 a processar, 4 parcial, 5 disponível */
  mediaStatus: number;
}

export async function search(seerr: SeerrClient, query: string): Promise<SearchResult[]> {
  const r = await seerr.get<{
    results: {
      id: number;
      mediaType: string;
      title?: string;
      name?: string;
      releaseDate?: string;
      firstAirDate?: string;
      posterPath?: string;
      mediaInfo?: { status: number };
    }[];
  }>(`search?query=${encodeURIComponent(query)}&page=1`);
  return r.results
    .filter((x) => x.mediaType === 'movie' || x.mediaType === 'tv')
    .map((x) => ({
      tmdbId: x.id,
      mediaType: x.mediaType as 'movie' | 'tv',
      title: x.title ?? x.name ?? '',
      year: (x.releaseDate ?? x.firstAirDate ?? '').slice(0, 4),
      poster: x.posterPath ? `${TMDB_IMG}${x.posterPath}` : null,
      mediaStatus: x.mediaInfo?.status ?? 1,
    }));
}

export interface RequestItem {
  id: number;
  /** 1 pendente, 2 aprovado, 3 recusado */
  status: number;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  poster: string | null;
  backdrop: string | null;
  requestedBy: string;
  createdAt: string;
}

interface TmdbDetail {
  title?: string;
  name?: string;
  posterPath?: string;
  backdropPath?: string;
}

export async function getRequests(seerr: SeerrClient): Promise<RequestItem[]> {
  const r = await seerr.get<{
    results: {
      id: number;
      status: number;
      createdAt: string;
      media: { mediaType: 'movie' | 'tv'; tmdbId: number };
      requestedBy?: { displayName?: string };
    }[];
  }>('request?take=20&sort=added');
  return Promise.all(
    r.results.map(async (x) => {
      const d = await seerr
        .get<TmdbDetail>(`${x.media.mediaType}/${x.media.tmdbId}`)
        .catch((): TmdbDetail => ({}));
      return {
        id: x.id,
        status: x.status,
        mediaType: x.media.mediaType,
        tmdbId: x.media.tmdbId,
        title: d.title ?? d.name ?? `TMDB ${x.media.tmdbId}`,
        poster: d.posterPath ? `${TMDB_IMG}${d.posterPath}` : null,
        backdrop: d.backdropPath ? `${TMDB_BACKDROP}${d.backdropPath}` : null,
        requestedBy: x.requestedBy?.displayName ?? '—',
        createdAt: x.createdAt,
      };
    }),
  );
}

export interface SystemInfo {
  services: {
    id: string;
    name: string;
    version: string | null;
    health: { type: string; message: string }[];
  }[];
  disks: { service: string; path: string; freeSpace: number; totalSpace: number }[];
}

export async function getSystem(ctx: Ctx, config: Config): Promise<SystemInfo> {
  void config;
  const one = async (id: string, name: string, c: Ctx['sonarr']) => {
    const [st, health] = await Promise.all([
      c.get<{ version: string }>('system/status').catch(() => null),
      c.get<{ type: string; message: string }[]>('health').catch(() => []),
    ]);
    return { id, name, version: st?.version ?? null, health };
  };
  const [sonarr, radarr, prowlarr, sDisk, rDisk] = await Promise.all([
    one('sonarr', 'Sonarr', ctx.sonarr),
    one('radarr', 'Radarr', ctx.radarr),
    one('prowlarr', 'Prowlarr', ctx.prowlarr),
    ctx.sonarr
      .get<{ path: string; freeSpace: number; totalSpace: number }[]>('diskspace')
      .catch(() => []),
    ctx.radarr
      .get<{ path: string; freeSpace: number; totalSpace: number }[]>('diskspace')
      .catch(() => []),
  ]);
  const dedupe = new Map<string, SystemInfo['disks'][number]>();
  for (const [service, list] of [
    ['sonarr', sDisk],
    ['radarr', rDisk],
  ] as const) {
    for (const d of list) if (!dedupe.has(d.path)) dedupe.set(d.path, { service, ...d });
  }
  return { services: [sonarr, radarr, prowlarr], disks: [...dedupe.values()] };
}
