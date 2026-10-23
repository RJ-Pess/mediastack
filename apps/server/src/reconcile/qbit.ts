export interface QbitPrefs {
  dl_limit: number;
  up_limit: number;
  max_ratio_enabled: boolean;
  max_ratio: number;
  [k: string]: unknown;
}

/** Cliente mínimo da WebAPI v2 do qBittorrent (sessão por cookie). */
export class QbitClient {
  private cookie: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly password: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async login(): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v2/auth/login`, {
      method: 'POST',
      body: new URLSearchParams({ username: this.username, password: this.password }),
      signal: AbortSignal.timeout(15_000),
    });
    const cookie = res.headers.get('set-cookie')?.split(';')[0];
    if (!res.ok || !cookie) throw new Error(`qBittorrent login: HTTP ${res.status}`);
    this.cookie = cookie;
  }

  private async call(path: string, form?: URLSearchParams, retry = true): Promise<Response> {
    if (!this.cookie) await this.login();
    const res = await this.fetchImpl(`${this.baseUrl}/api/v2/${path}`, {
      method: form ? 'POST' : 'GET',
      headers: { Cookie: this.cookie! },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 403 && retry) {
      this.cookie = null;
      return this.call(path, form, false);
    }
    if (!res.ok) throw new Error(`qBittorrent ${path}: HTTP ${res.status} ${await res.text()}`);
    return res;
  }

  getPrefs = async () => (await (await this.call('app/preferences')).json()) as QbitPrefs;

  async setPrefs(p: Partial<QbitPrefs>): Promise<void> {
    await this.call('app/setPreferences', new URLSearchParams({ json: JSON.stringify(p) }));
  }

  async getCategories(): Promise<Record<string, { name: string; savePath: string }>> {
    return (await (await this.call('torrents/categories')).json()) as never;
  }

  async setCategory(name: string, savePath: string, exists: boolean): Promise<void> {
    await this.call(
      exists ? 'torrents/editCategory' : 'torrents/createCategory',
      new URLSearchParams({ category: name, savePath }),
    );
  }
}
