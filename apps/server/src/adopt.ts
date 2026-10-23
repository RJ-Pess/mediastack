import type { ArrResource } from './reconcile/arr.js';
import type { Ctx } from './plan/ctx.js';
import { defaultDesired, type Desired } from './plan/desired.js';

export interface Derived {
  desired: Desired;
  /** O que foi encontrado e pressupostos feitos, em português, para o utilizador rever. */
  notes: string[];
}

const dirname = (p: string) => p.replace(/\/[^/]*\/?$/, '') || '/';

interface Profile {
  name: string;
}

/**
 * Lê (sem alterar nada) uma instalação existente e converte-a em estado desejado.
 * O que não se consegue inferir fica no valor "não mexer" ou no valor por omissão.
 */
export async function deriveDesired(ctx: Ctx): Promise<Derived> {
  const d = defaultDesired();
  const notes: string[] = [];
  const soft = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      notes.push(
        `Não foi possível ler ${label}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  };

  const [sRoots, rRoots, sClients, rClients, prefs, cats] = await Promise.all([
    soft('as pastas do Sonarr', () => ctx.sonarr.get<{ path: string }[]>('rootfolder')),
    soft('as pastas do Radarr', () => ctx.radarr.get<{ path: string }[]>('rootfolder')),
    soft('os download clients do Sonarr', () => ctx.sonarr.get<ArrResource[]>('downloadclient')),
    soft('os download clients do Radarr', () => ctx.radarr.get<ArrResource[]>('downloadclient')),
    soft('as definições do qBittorrent', () => ctx.qbit.getPrefs()),
    soft('as categorias do qBittorrent', () => ctx.qbit.getCategories()),
  ]);

  // Armazenamento
  if (sRoots?.length) {
    d.storage.tvRoot = sRoots[0]!.path;
    d.storage.extraTvRoots = sRoots.slice(1).map((r) => r.path);
    notes.push(`Séries: ${sRoots.length} pasta(s) no Sonarr.`);
  }
  if (rRoots?.length) {
    d.storage.moviesRoot = rRoots[0]!.path;
    d.storage.extraMoviesRoots = rRoots.slice(1).map((r) => r.path);
    notes.push(`Filmes: ${rRoots.length} pasta(s) no Radarr.`);
  }

  // Downloads: categoria do 1.º download client qBittorrent
  const category = (clients: ArrResource[] | null, field: string) => {
    const c = clients?.find((x) => x.implementation === 'QBittorrent');
    return c ? (c.fields?.find((f) => f.name === field)?.value as string | undefined) : undefined;
  };
  const tvCat = category(sClients, 'tvCategory');
  const movieCat = category(rClients, 'movieCategory');
  if (tvCat) d.downloads.categories.tv = tvCat;
  else notes.push('O Sonarr não tem download client qBittorrent: usada a categoria "tv".');
  if (movieCat) d.downloads.categories.movies = movieCat;
  else notes.push('O Radarr não tem download client qBittorrent: usada a categoria "movies".');

  if (prefs) {
    d.downloads.downKiBps = Math.round(prefs.dl_limit / 1024);
    d.downloads.upKiBps = Math.round(prefs.up_limit / 1024);
    d.downloads.seedRatio = prefs.max_ratio_enabled ? prefs.max_ratio : 0;
    const p = prefs as Record<string, unknown>;
    d.downloads.seedTimeMinutes =
      p.max_seeding_time_enabled === true ? Number(p.max_seeding_time) : 0;
    if (p.scheduler_enabled === true) {
      d.downloads.schedule = {
        enabled: true,
        fromHour: Number(p.schedule_from_hour),
        toHour: Number(p.schedule_to_hour),
        altDownKiBps: Math.round(Number(p.alt_dl_limit) / 1024),
        altUpKiBps: Math.round(Number(p.alt_up_limit) / 1024),
      };
    }
  }
  // Raiz dos torrents: a pasta-mãe da categoria; senão a pasta de descarga por omissão.
  const catPath = cats && tvCat ? cats[tvCat]?.savePath : undefined;
  const defaultSave = (prefs as { save_path?: string } | null)?.save_path;
  if (catPath) d.downloads.torrentsRoot = dirname(catPath);
  else if (defaultSave) d.downloads.torrentsRoot = defaultSave.replace(/\/$/, '');

  // Legendas (Bazarr): idiomas do 1.º perfil, senão os idiomas ativos
  const [profiles, langs] = await Promise.all([
    soft('os perfis do Bazarr', () => ctx.bazarr.getProfiles()),
    soft('os idiomas do Bazarr', () => ctx.bazarr.getLanguages()),
  ]);
  const fromProfile = profiles?.[0]?.items.map((i) => i.language);
  const enabled = langs?.filter((l) => l.enabled).map((l) => l.code2);
  const subs = fromProfile?.length ? fromProfile : enabled;
  if (subs?.length) d.subtitles.languages = [...new Set(subs)];
  else notes.push('O Bazarr não tem idiomas ativos: mantidos os idiomas por omissão.');

  // Qualidade: só mexe nos perfis se já houver perfis TRaSH reconhecíveis
  const [sp, rp] = await Promise.all([
    soft('os perfis do Sonarr', () => ctx.sonarr.get<Profile[]>('qualityprofile')),
    soft('os perfis do Radarr', () => ctx.radarr.get<Profile[]>('qualityprofile')),
  ]);
  const names = new Set([...(sp ?? []), ...(rp ?? [])].map((p) => p.name));
  const hd = names.has('HD Bluray + WEB') || names.has('WEB-1080p');
  const uhd = names.has('UHD Bluray + WEB') || names.has('WEB-2160p');
  if (hd && uhd) d.quality.profile = 'both';
  else if (uhd) d.quality.profile = '4k';
  else if (hd) d.quality.profile = '1080p';
  else {
    d.quality.profile = 'keep';
    notes.push('Não há perfis TRaSH: os teus perfis de qualidade ficam como estão.');
  }

  // Nomes: reconhece os presets TRaSH; senão não mexe
  const naming = await soft('o esquema de nomes do Radarr', () =>
    ctx.radarr.get<{ standardMovieFormat?: string }>('config/naming'),
  );
  const fmt = naming?.standardMovieFormat ?? '';
  if (fmt.includes('tmdbid-')) d.naming.scheme = 'jellyfin';
  else if (fmt.includes('{tmdb-')) d.naming.scheme = 'plex';
  else d.naming.scheme = 'keep';
  if (d.naming.scheme === 'keep')
    notes.push('Os nomes de ficheiros não seguem um preset TRaSH: ficam como estão.');

  // Backups
  const host = await soft('a agenda de backups do Sonarr', () =>
    ctx.sonarr.get<{ backupInterval?: number; backupRetention?: number }>('config/host'),
  );
  if (host?.backupInterval) d.backups.intervalDays = host.backupInterval;
  if (host?.backupRetention) d.backups.retentionDays = host.backupRetention;

  notes.push('As notificações existentes não são tocadas.');
  return { desired: d, notes };
}

/** Caminhos folha que diferem entre dois objetos (para mostrar "antes → depois"). */
export function diffLeaves(
  from: unknown,
  to: unknown,
  path = '',
): { path: string; from: unknown; to: unknown }[] {
  const isObj = (x: unknown): x is Record<string, unknown> =>
    typeof x === 'object' && x !== null && !Array.isArray(x);
  if (isObj(from) && isObj(to)) {
    return [...new Set([...Object.keys(from), ...Object.keys(to)])].flatMap((k) =>
      diffLeaves(from[k], to[k], path ? `${path}.${k}` : k),
    );
  }
  return JSON.stringify(from) === JSON.stringify(to) ? [] : [{ path, from, to }];
}
