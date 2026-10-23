import type { ServiceId } from '../services.js';
import { MANAGED_PREFIX } from '../reconcile/wiring.js';
import type { ArrClient, ArrResource } from '../reconcile/arr.js';
import { seerrDefinition } from '../reconcile/wiring.js';
import {
  expectedProfiles,
  readRequest,
  type RecyclarrRequest,
  type NamingScheme,
  readSyncStatus,
  renderRequest,
  requestSync,
} from '../quality/recyclarr.js';
import type { Ctx } from './ctx.js';
import type { Desired } from './desired.js';

/**
 * Um valor configurável num serviço. O plan lê o valor real e compara com o desejado;
 * o apply escreve; a deteção de drift é um plan sobre o estado já aplicado.
 */
export interface Field<T = unknown> {
  id: string;
  service: ServiceId;
  section: 'Armazenamento' | 'Downloads' | 'Legendas' | 'Qualidade' | 'Backups' | 'Notificações';
  label: string;
  /** `undefined` = campo não gerido pelo estado desejado. */
  desired(s: Desired): T | undefined;
  read(ctx: Ctx): Promise<T>;
  write(ctx: Ctx, value: T): Promise<void>;
  /** Escritas lentas (ex.: esperar pelo Recyclarr) não se repetem automaticamente. */
  noRetry?: boolean;
  /** `false` = o campo não se aplica agora (ex.: o Seerr ainda não está ligado). */
  applicable?(ctx: Ctx): boolean;
  /** Igualdade desejado/real (por omissão, JSON). */
  equal?(desired: T, actual: T): boolean;
  /** Copia o valor real para o estado desejado ("adotar"). */
  adopt(s: Desired, actual: T): Desired;
}

const clone = <T>(x: T): T => structuredClone(x);
/** O cliente criado pelo MediaStack ou, numa instalação importada, o 1.º qBittorrent existente. */
const downloadClient = async (c: ArrClient) => {
  const all = await c.get<ArrResource[]>('downloadclient');
  return (
    all.find((r) => r.name === `${MANAGED_PREFIX} qBittorrent`) ??
    all.find((r) => r.implementation === 'QBittorrent')
  );
};

const categoryField = (
  app: 'sonarr' | 'radarr',
  key: 'tv' | 'movies',
  fieldName: string,
): Field<string> => ({
  id: `${app}.downloadclient.category`,
  service: app,
  section: 'Downloads',
  label: 'Categoria no qBittorrent',
  desired: (s) => s.downloads.categories[key],
  read: async (ctx) => {
    const dc = await downloadClient(ctx[app]);
    return String(dc?.fields?.find((f) => f.name === fieldName)?.value ?? '');
  },
  write: async (ctx, v) => {
    const dc = await downloadClient(ctx[app]);
    if (!dc)
      throw new Error('download client MediaStack qBittorrent não existe (corre o reconcile)');
    await ctx[app].ensure('downloadclient', dc.name, 'QBittorrent', { [fieldName]: v });
  },
  adopt: (s, v) => {
    const n = clone(s);
    n.downloads.categories[key] = v;
    return n;
  },
});

const rootsField = (app: 'sonarr' | 'radarr'): Field<string[]> => ({
  id: `${app}.rootfolders`,
  service: app,
  section: 'Armazenamento',
  label: 'Root folders',
  desired: (s) =>
    app === 'sonarr'
      ? [s.storage.tvRoot, ...s.storage.extraTvRoots]
      : [s.storage.moviesRoot, ...s.storage.extraMoviesRoots],
  read: async (ctx) =>
    (await ctx[app].get<{ path: string }[]>('rootfolder')).map((r) => r.path).sort(),
  // Só adiciona: nunca remove pastas que o MediaStack não criou.
  write: async (ctx, want) => {
    const have = (await ctx[app].get<{ path: string }[]>('rootfolder')).map((r) => r.path);
    for (const path of want.filter((p) => !have.includes(p))) {
      await ctx[app].request('POST', 'rootfolder', { path });
    }
  },
  equal: (want, have) => want.every((p) => have.includes(p)),
  adopt: (s, have) => {
    const n = clone(s);
    const [main, ...extra] = have;
    if (app === 'sonarr') {
      n.storage.tvRoot = main ?? n.storage.tvRoot;
      n.storage.extraTvRoots = extra;
    } else {
      n.storage.moviesRoot = main ?? n.storage.moviesRoot;
      n.storage.extraMoviesRoots = extra;
    }
    return n;
  },
});

const PROFILE = 'MediaStack';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const requestFor = (ctx: Ctx, req: RecyclarrRequest) =>
  renderRequest(
    req,
    { url: ctx.config.MEDIASTACK_RADARR_URL, key: ctx.secrets['radarr.key'] },
    { url: ctx.config.MEDIASTACK_SONARR_URL, key: ctx.secrets['sonarr.key'] },
  );

const profilesField = (app: 'radarr' | 'sonarr', timeoutMs = 180_000): Field<string[]> => ({
  id: `${app}.qualityprofiles`,
  service: app,
  section: 'Qualidade',
  label: 'Perfis de qualidade TRaSH',
  desired: (s) => expectedProfiles(s.quality.profile, app),
  read: async (ctx) =>
    (await ctx[app].get<{ name: string }[]>('qualityprofile')).map((p) => p.name),
  equal: (want, have) => want.every((n) => have.includes(n)),
  noRetry: true,
  // O Recyclarr cria os perfis de forma assíncrona; espera por eles (e volta a pedir se falhou).
  write: async (ctx, want) => {
    const status = readSyncStatus(ctx.recyclarrDir);
    const req = readRequest(ctx.recyclarrDir);
    if (status.status !== 'pending' && (status.status !== 'ok' || !req)) {
      if (req) requestSync(ctx.recyclarrDir, requestFor(ctx, req));
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const have = (await ctx[app].get<{ name: string }[]>('qualityprofile')).map((p) => p.name);
      if (want.every((n) => have.includes(n))) return;
      await sleep(5_000);
    }
    throw new Error(
      `o Recyclarr não criou os perfis ${want.join(', ')} (última sincronização: ${readSyncStatus(ctx.recyclarrDir).status})`,
    );
  },
  adopt: (s) => s,
});

const seerrProfileField = (app: 'radarr' | 'sonarr'): Field<string> => ({
  id: `seerr.profile.${app}`,
  service: 'seerr',
  section: 'Qualidade',
  label: `Perfil por omissão no Seerr (${app === 'radarr' ? 'filmes' : 'séries'})`,
  desired: (s) => expectedProfiles(s.quality.profile, app)[0],
  applicable: (ctx) => ctx.seerr !== null,
  read: async (ctx) =>
    ctx.seerr!.getArrProfileName(app, `MediaStack ${app === 'radarr' ? 'Radarr' : 'Sonarr'}`),
  write: async (ctx, name) => {
    const def = await seerrDefinition(ctx.config, ctx.secrets, app, ctx[app], name);
    await ctx.seerr!.ensureArr(app, def);
  },
  adopt: (s) => s,
});

const NOTIFICATION = 'MediaStack';
const IMPLEMENTATION = { ntfy: 'Ntfy', discord: 'Discord', telegram: 'Telegram' } as const;

export interface NotificationValue {
  type: 'none' | 'ntfy' | 'discord' | 'telegram';
  serverUrl: string;
  topic: string;
  chatId: string;
}

const fieldValue = (r: ArrResource, name: string) => r.fields?.find((f) => f.name === name)?.value;

/** Um destino de notificações igual em todos os *arr (o segredo vem do cofre). */
const notificationField = (app: 'sonarr' | 'radarr' | 'prowlarr'): Field<NotificationValue> => ({
  id: `${app}.notification`,
  service: app,
  section: 'Notificações',
  label: 'Destino das notificações',
  desired: (s) => {
    const n = s.notifications;
    return {
      type: n.type,
      serverUrl: n.type === 'ntfy' ? n.ntfyServerUrl : '',
      topic: n.type === 'ntfy' ? n.ntfyTopic : '',
      chatId: n.type === 'telegram' ? n.telegramChatId : '',
    };
  },
  read: async (ctx) => {
    const r = (await ctx[app].get<ArrResource[]>('notification')).find(
      (n) => n.name === NOTIFICATION,
    );
    const none: NotificationValue = { type: 'none', serverUrl: '', topic: '', chatId: '' };
    if (!r) return none;
    const type = (Object.entries(IMPLEMENTATION).find(([, v]) => v === r.implementation)?.[0] ??
      'none') as NotificationValue['type'];
    return {
      type,
      serverUrl: type === 'ntfy' ? String(fieldValue(r, 'serverUrl') ?? '') : '',
      topic:
        type === 'ntfy' ? String((fieldValue(r, 'topics') as string[] | undefined)?.[0] ?? '') : '',
      chatId: type === 'telegram' ? String(fieldValue(r, 'chatId') ?? '') : '',
    };
  },
  write: async (ctx, v) => {
    const client = ctx[app];
    const existing = (await client.get<ArrResource[]>('notification')).find(
      (n) => n.name === NOTIFICATION,
    );
    const impl = v.type === 'none' ? null : IMPLEMENTATION[v.type];
    // Mudar de tipo (ou desligar): remove só o recurso que o próprio MediaStack criou.
    if (existing && existing.implementation !== impl) {
      await client.request('DELETE', `notification/${existing.id}`);
    }
    if (!impl) return;
    const secret = ctx.getSecret('notifications.secret');
    if (!secret && v.type !== 'ntfy') {
      throw new Error('falta o segredo das notificações (webhook ou token)');
    }
    const fields: Record<string, unknown> =
      v.type === 'ntfy'
        ? { serverUrl: v.serverUrl, topics: [v.topic], accessToken: secret ?? '' }
        : v.type === 'discord'
          ? { webHookUrl: secret }
          : { botToken: secret, chatId: v.chatId };
    const triggers =
      app === 'prowlarr'
        ? { onHealthIssue: true }
        : {
            onDownload: true,
            onUpgrade: true,
            onHealthIssue: true,
            onManualInteractionRequired: true,
          };
    await client.ensure('notification', NOTIFICATION, impl, fields, triggers);
  },
  adopt: (s, v) => {
    const n = clone(s);
    n.notifications.type = v.type;
    if (v.type === 'ntfy') {
      n.notifications.ntfyServerUrl = v.serverUrl;
      n.notifications.ntfyTopic = v.topic;
    }
    if (v.type === 'telegram') n.notifications.telegramChatId = v.chatId;
    return n;
  },
});

const notificationFields: AnyField[] = (['sonarr', 'radarr', 'prowlarr'] as const).map(
  notificationField,
);

/** Agenda e retenção dos backups nativos (config/host) do Sonarr, Radarr e Prowlarr. */
const backupField = (
  app: 'sonarr' | 'radarr' | 'prowlarr',
  key: 'backupInterval' | 'backupRetention',
): Field<number> => {
  const interval = key === 'backupInterval';
  return {
    id: `${app}.backup.${interval ? 'interval' : 'retention'}`,
    service: app,
    section: 'Backups',
    label: interval ? 'Intervalo entre backups (dias)' : 'Retenção dos backups (dias)',
    desired: (s) => (interval ? s.backups.intervalDays : s.backups.retentionDays),
    read: async (ctx) => (await ctx[app].get<Record<string, number>>('config/host'))[key] ?? 0,
    write: async (ctx, v) => {
      const host = await ctx[app].get<Record<string, unknown>>('config/host');
      await ctx[app].request('PUT', `config/host/${host.id}`, { ...host, [key]: v });
    },
    adopt: (s, v) => {
      const n = clone(s);
      if (interval) n.backups.intervalDays = v;
      else n.backups.retentionDays = v;
      return n;
    },
  };
};

const backupFields: AnyField[] = (['sonarr', 'radarr', 'prowlarr'] as const).flatMap((app) => [
  backupField(app, 'backupInterval'),
  backupField(app, 'backupRetention'),
]);

const qualityFields: AnyField[] = [
  {
    id: 'recyclarr.request',
    service: 'recyclarr',
    section: 'Qualidade',
    label: 'Perfil de qualidade e nomes pedidos ao Recyclarr',
    // Só quando há algo a pedir ao Recyclarr (perfis TRaSH e/ou nomes).
    desired: (s) =>
      s.quality.profile === 'keep' && s.naming.scheme === 'keep'
        ? undefined
        : { quality: s.quality.profile, naming: s.naming.scheme },
    read: async (ctx) =>
      readRequest(ctx.recyclarrDir) ?? ({ quality: '', naming: '' } as unknown as RecyclarrRequest),
    write: async (ctx, req: RecyclarrRequest) =>
      requestSync(ctx.recyclarrDir, requestFor(ctx, req)),
    adopt: (s, req: RecyclarrRequest) => {
      const n = clone(s);
      if (req.quality) n.quality.profile = req.quality;
      n.naming.scheme = req.naming as NamingScheme;
      return n;
    },
  } satisfies Field<RecyclarrRequest>,
  profilesField('radarr'),
  profilesField('sonarr'),
  seerrProfileField('radarr'),
  seerrProfileField('sonarr'),
];

const bazarrFields: AnyField[] = [
  {
    id: 'bazarr.languages.enabled',
    service: 'bazarr',
    section: 'Legendas',
    label: 'Idiomas ativos',
    desired: (s) => [...s.subtitles.languages].sort(),
    read: async (ctx) =>
      (await ctx.bazarr.getLanguages())
        .filter((l) => l.enabled)
        .map((l) => l.code2)
        .sort(),
    write: (ctx, v: string[]) => ctx.bazarr.enableLanguages(v),
    // Só ativa: nunca desativa idiomas que outra pessoa ligou.
    equal: (want: string[], have: string[]) => want.every((c) => have.includes(c)),
    adopt: (s) => s,
  } satisfies Field<string[]>,
  {
    id: 'bazarr.profile',
    service: 'bazarr',
    section: 'Legendas',
    label: `Perfil de idiomas "${PROFILE}"`,
    desired: (s) => s.subtitles.languages,
    read: async (ctx) =>
      (await ctx.bazarr.getProfiles())
        .find((p) => p.name === PROFILE)
        ?.items.map((i) => i.language) ?? [],
    write: (ctx, v: string[]) => ctx.bazarr.upsertProfile(PROFILE, v),
    adopt: (s, v: string[]) => {
      const n = clone(s);
      if (v.length) n.subtitles.languages = v;
      return n;
    },
  } satisfies Field<string[]>,
  {
    id: 'bazarr.profile.default',
    service: 'bazarr',
    section: 'Legendas',
    label: 'Perfil por omissão (séries e filmes)',
    desired: () => PROFILE,
    read: async (ctx) => {
      const s = (await ctx.bazarr.getSettings()).general;
      const profiles = await ctx.bazarr.getProfiles();
      const nameOf = (id: unknown) =>
        profiles.find((p) => String(p.profileId) === String(id))?.name;
      const serie = nameOf(s?.serie_default_profile);
      return serie !== undefined && serie === nameOf(s?.movie_default_profile) ? serie : '';
    },
    write: async (ctx, v: string) => {
      const p = (await ctx.bazarr.getProfiles()).find((x) => x.name === v);
      if (!p) throw new Error(`perfil "${v}" ainda não existe no Bazarr`);
      await ctx.bazarr.ensureSettings({
        general: { serie_default_profile: p.profileId, movie_default_profile: p.profileId },
      });
    },
    adopt: (s) => s,
  } satisfies Field<string>,
];

const prefField = (
  id: string,
  label: string,
  get: (s: Desired) => number,
  set: (s: Desired, v: number) => void,
  read: (p: Awaited<ReturnType<Ctx['qbit']['getPrefs']>>) => number,
  write: (v: number) => Record<string, unknown>,
): Field<number> => ({
  id,
  service: 'qbittorrent',
  section: 'Downloads',
  label,
  desired: get,
  read: async (ctx) => read(await ctx.qbit.getPrefs()),
  write: (ctx, v) => ctx.qbit.setPrefs(write(v)),
  adopt: (s, v) => {
    const n = clone(s);
    set(n, v);
    return n;
  },
});

// Os campos têm tipos de valor diferentes; o engine só os trata como `unknown`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyField = Field<any>;

type Schedule = Desired['downloads']['schedule'];
const OFF: Schedule = { enabled: false, fromHour: 0, toHour: 0, altDownKiBps: 0, altUpKiBps: 0 };
/** Desligado, os restantes valores não contam (o qBittorrent guarda-os na mesma). */
const normSchedule = (x: Schedule): Schedule => (x.enabled ? x : OFF);

/** Limites alternativos de velocidade num horário. A API quer hora E minuto, sempre juntos. */
const scheduleField: Field<Schedule> = {
  id: 'qbittorrent.schedule',
  service: 'qbittorrent',
  section: 'Downloads',
  label: 'Horário de limites de velocidade',
  desired: (s) => normSchedule(s.downloads.schedule),
  read: async (ctx) => {
    const p = (await ctx.qbit.getPrefs()) as Record<string, unknown>;
    return normSchedule({
      enabled: p.scheduler_enabled === true,
      fromHour: Number(p.schedule_from_hour),
      toHour: Number(p.schedule_to_hour),
      altDownKiBps: Math.round(Number(p.alt_dl_limit) / 1024),
      altUpKiBps: Math.round(Number(p.alt_up_limit) / 1024),
    });
  },
  write: (ctx, v) =>
    ctx.qbit.setPrefs(
      v.enabled
        ? {
            scheduler_enabled: true,
            scheduler_days: 0,
            schedule_from_hour: v.fromHour,
            schedule_from_min: 0,
            schedule_to_hour: v.toHour,
            schedule_to_min: 0,
            alt_dl_limit: v.altDownKiBps * 1024,
            alt_up_limit: v.altUpKiBps * 1024,
          }
        : { scheduler_enabled: false },
    ),
  adopt: (s, v) => {
    const n = clone(s);
    n.downloads.schedule = v.enabled ? v : { ...n.downloads.schedule, enabled: false };
    return n;
  },
};

export const staticFields: AnyField[] = [
  rootsField('sonarr'),
  rootsField('radarr'),
  categoryField('sonarr', 'tv', 'tvCategory'),
  categoryField('radarr', 'movies', 'movieCategory'),
  ...bazarrFields,
  ...qualityFields,
  ...backupFields,
  ...notificationFields,
  prefField(
    'qbittorrent.limit.down',
    'Limite de descarga (KiB/s, 0 = sem limite)',
    (s) => s.downloads.downKiBps,
    (s, v) => (s.downloads.downKiBps = v),
    (p) => Math.round(p.dl_limit / 1024),
    (v) => ({ dl_limit: v * 1024 }),
  ),
  prefField(
    'qbittorrent.limit.up',
    'Limite de envio (KiB/s, 0 = sem limite)',
    (s) => s.downloads.upKiBps,
    (s, v) => (s.downloads.upKiBps = v),
    (p) => Math.round(p.up_limit / 1024),
    (v) => ({ up_limit: v * 1024 }),
  ),
  prefField(
    'qbittorrent.seed.time',
    'Tempo máximo de seeding (min, 0 = desligado)',
    (s) => s.downloads.seedTimeMinutes,
    (s, v) => (s.downloads.seedTimeMinutes = v),
    (p) => (p.max_seeding_time_enabled === true ? Number(p.max_seeding_time) : 0),
    (v) => ({ max_seeding_time_enabled: v > 0, max_seeding_time: v > 0 ? v : -1 }),
  ),
  scheduleField,
  prefField(
    'qbittorrent.seed.ratio',
    'Rácio máximo de seeding (0 = desligado)',
    (s) => s.downloads.seedRatio,
    (s, v) => (s.downloads.seedRatio = v),
    (p) => (p.max_ratio_enabled ? p.max_ratio : 0),
    (v) => ({ max_ratio_enabled: v > 0, max_ratio: v > 0 ? v : -1 }),
  ),
];

/** Campos que dependem do estado desejado (nomes de categoria dinâmicos). */
export function allFields(d: Desired): AnyField[] {
  const catFields = (['tv', 'movies'] as const).map((key): Field<string> => {
    const name = d.downloads.categories[key];
    return {
      id: `qbittorrent.category.${key}`,
      service: 'qbittorrent',
      section: 'Downloads',
      label: `Pasta da categoria "${name}" (${key === 'tv' ? 'séries' : 'filmes'})`,
      desired: (s) => `${s.downloads.torrentsRoot}/${name}`,
      read: async (ctx) => (await ctx.qbit.getCategories())[name]?.savePath ?? '',
      write: async (ctx, v) => {
        const exists = name in (await ctx.qbit.getCategories());
        await ctx.qbit.setCategory(name, v, exists);
      },
      // A pasta deriva de torrentsRoot + nome da categoria; não há campo próprio para adotar.
      adopt: (s) => s,
    };
  });
  return [...staticFields, ...catFields];
}
