import type { EnsureResult } from './arr.js';

export interface BazarrProfile {
  profileId: number;
  name: string;
  items: { id: number; language: string; audio_exclude: string; hi: string; forced: string }[];
  [k: string]: unknown;
}

type Settings = Record<string, Record<string, unknown>>;

/** Cliente mínimo da API do Bazarr (settings por formulário `settings-<secção>-<chave>`). */
export class BazarrClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers = () => ({ 'X-API-KEY': this.apiKey });

  async getSettings(): Promise<Settings> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/system/settings`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Bazarr GET settings: HTTP ${res.status}`);
    return (await res.json()) as Settings;
  }

  /** Aplica `desired[secção][chave]` só se diferir do valor atual. */
  async ensureSettings(desired: Settings): Promise<EnsureResult> {
    const current = await this.getSettings();
    const form = new URLSearchParams();
    for (const [section, keys] of Object.entries(desired)) {
      for (const [key, want] of Object.entries(keys)) {
        if (String(current[section]?.[key]) !== String(want)) {
          form.append(`settings-${section}-${key}`, String(want));
        }
      }
    }
    if (![...form].length) return 'unchanged';
    const res = await this.fetchImpl(`${this.baseUrl}/api/system/settings`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Bazarr POST settings: HTTP ${res.status} ${await res.text()}`);
    return 'updated';
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/${path}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Bazarr GET ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  getLanguages = () =>
    this.getJson<{ code2: string; name: string; enabled: boolean }[]>('system/languages');

  getProfiles = () => this.getJson<BazarrProfile[]>('system/languages/profiles');

  async postForm(form: URLSearchParams): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/system/settings`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Bazarr POST settings: HTTP ${res.status} ${await res.text()}`);
  }

  /** Ativa idiomas. O Bazarr desativa todos os que não vêm no pedido, por isso enviamos a união. */
  async enableLanguages(codes: string[]): Promise<void> {
    const form = new URLSearchParams();
    const union = new Set([
      ...(await this.getLanguages()).filter((l) => l.enabled).map((l) => l.code2),
      ...codes,
    ]);
    for (const c of union) form.append('languages-enabled', c);
    await this.postForm(form);
  }

  /**
   * Cria/atualiza um perfil pelo nome. O Bazarr apaga os perfis que faltem no pedido,
   * por isso reenviamos sempre todos os existentes.
   */
  async upsertProfile(name: string, languages: string[]): Promise<void> {
    const profiles = await this.getProfiles();
    const items = languages.map((language, i) => ({
      id: i + 1,
      language,
      audio_exclude: 'False',
      hi: 'False',
      forced: 'False',
    }));
    const mine = profiles.find((p) => p.name === name);
    const next: BazarrProfile = mine
      ? { ...mine, items }
      : {
          profileId: Math.max(0, ...profiles.map((p) => p.profileId)) + 1,
          name,
          cutoff: null,
          items,
          mustContain: [],
          mustNotContain: [],
          originalFormat: false,
          tag: null,
        };
    const all = [...profiles.filter((p) => p.name !== name), next];
    await this.postForm(new URLSearchParams({ 'languages-profiles': JSON.stringify(all) }));
  }
}
