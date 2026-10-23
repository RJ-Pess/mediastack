import type { EnsureResult } from './arr.js';

export interface JellyfinLogin {
  hostname: string;
  port: number;
  useSsl: boolean;
  urlBase?: string;
  username: string;
  password: string;
  email?: string;
}

export interface SeerrArrDef {
  name: string;
  hostname: string;
  port: number;
  apiKey: string;
  useSsl: boolean;
  baseUrl: string;
  activeProfileId: number;
  activeProfileName: string;
  activeDirectory: string;
  isDefault: boolean;
  [k: string]: unknown;
}

/** Cliente mínimo da API do Seerr. Fora do setup autentica-se com a API key. */
export class SeerrClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | null = null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown, cookie?: string) {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'X-Api-Key': this.apiKey } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Seerr ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
    return { data: (await res.json()) as T, res };
  }

  get = async <T>(path: string) => (await this.call<T>('GET', path)).data;
  post = async <T>(path: string, body: unknown = {}) =>
    (await this.call<T>('POST', path, body)).data;

  async isInitialized(): Promise<boolean> {
    return (await this.call<{ initialized: boolean }>('GET', 'settings/public')).data.initialized;
  }

  /**
   * Setup inicial sem a página /setup: autentica com o admin do Jellyfin (que cria o admin
   * do Seerr), lê a API key e marca como inicializado. Devolve a API key.
   */
  async setupWithJellyfin(j: JellyfinLogin): Promise<string> {
    const { res } = await this.call('POST', 'auth/jellyfin', {
      username: j.username,
      password: j.password,
      hostname: j.hostname,
      port: j.port,
      useSsl: j.useSsl,
      urlBase: j.urlBase ?? '',
      email: j.email ?? `${j.username}@mediastack.local`,
      serverType: 2,
    });
    const cookie = res.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('Seerr: login no Jellyfin não devolveu sessão');
    const main = await this.call<{ apiKey: string }>('GET', 'settings/main', undefined, cookie);
    await this.call('POST', 'settings/initialize', {}, cookie);
    return main.data.apiKey;
  }

  /** Perfil de qualidade configurado no Sonarr/Radarr (`name`) dentro do Seerr. */
  async getArrProfileName(kind: 'sonarr' | 'radarr', name: string): Promise<string> {
    const list = await this.get<SeerrArrDef[]>(`settings/${kind}`);
    return list.find((x) => x.name === name)?.activeProfileName ?? '';
  }

  /** Pasta de raiz configurada no Sonarr/Radarr (`name`) dentro do Seerr. */
  async getArrDirectory(kind: 'sonarr' | 'radarr', name: string): Promise<string> {
    const list = await this.get<SeerrArrDef[]>(`settings/${kind}`);
    return list.find((x) => x.name === name)?.activeDirectory ?? '';
  }

  /** Cria ou atualiza o Sonarr/Radarr (`kind`) com este nome; idempotente. */
  async ensureArr(
    kind: 'sonarr' | 'radarr',
    want: SeerrArrDef,
    /** Campos geridos pelo plan (ex.: perfil): só são definidos ao criar. */
    createOnly: string[] = [],
  ): Promise<EnsureResult> {
    const body = {
      is4k: false,
      syncEnabled: false,
      preventSearch: false,
      tagRequests: false,
      ...(kind === 'sonarr' ? { enableSeasonFolders: true } : { minimumAvailability: 'released' }),
      ...want,
    };
    const existing = (await this.call<SeerrArrDef[]>('GET', `settings/${kind}`)).data.find(
      (x) => x.name === want.name,
    ) as (SeerrArrDef & { id: number }) | undefined;
    if (!existing) {
      await this.call('POST', `settings/${kind}`, body);
      return 'created';
    }
    const wanted = Object.fromEntries(
      Object.entries(want).filter(([k]) => !createOnly.includes(k)),
    );
    const differs = Object.entries(wanted).some(
      ([k, v]) => JSON.stringify(existing[k]) !== JSON.stringify(v),
    );
    if (!differs) return 'unchanged';
    // O Seerr recusa `id` no corpo (é só-leitura); o id vai no caminho.
    const { id, ...rest } = existing;
    await this.call('PUT', `settings/${kind}/${id}`, { ...rest, ...body, ...wanted });
    return 'updated';
  }
}
