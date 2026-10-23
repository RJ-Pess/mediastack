import type { EnsureResult } from './arr.js';

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
}
