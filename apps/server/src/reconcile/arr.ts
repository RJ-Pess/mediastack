export interface ArrField {
  name: string;
  value?: unknown;
  [k: string]: unknown;
}

export interface ArrResource {
  id?: number;
  name: string;
  implementation?: string;
  fields?: ArrField[];
  tags?: number[];
  [k: string]: unknown;
}

export type EnsureResult = 'created' | 'updated' | 'unchanged';

/** Valores sensíveis voltam mascarados nos GET; não os podemos comparar. */
const MASKED = '********';

/** Cliente mínimo da API Servarr (Sonarr/Radarr v3, Prowlarr v1). */
export class ArrClient {
  constructor(
    readonly label: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly version: 'v3' | 'v1',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/${this.version}/${path}`, {
      method,
      headers: { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`${this.label} ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  get = <T>(path: string) => this.request<T>('GET', path);

  /**
   * Garante que existe um recurso (download client, application, proxy…) com este nome
   * e estes campos. Idempotente: só escreve se algo diferir.
   */
  async ensure(
    collection: string,
    name: string,
    implementation: string,
    fields: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ): Promise<EnsureResult> {
    const existing = (await this.get<ArrResource[]>(collection)).find((r) => r.name === name);
    if (!existing) {
      const schema = (await this.get<ArrResource[]>(`${collection}/schema`)).find(
        (s) => s.implementation === implementation,
      );
      if (!schema)
        throw new Error(`${this.label}: sem schema "${implementation}" em ${collection}`);
      const body = { ...schema, ...extra, name, fields: applyFields(schema.fields ?? [], fields) };
      await this.request('POST', `${collection}?forceSave=true`, body);
      return 'created';
    }
    const dirty =
      Object.entries(extra).some(([k, v]) => JSON.stringify(existing[k]) !== JSON.stringify(v)) ||
      fieldsDiffer(existing.fields ?? [], fields);
    if (!dirty) return 'unchanged';
    const body = { ...existing, ...extra, fields: applyFields(existing.fields ?? [], fields) };
    await this.request('PUT', `${collection}/${existing.id}?forceSave=true`, body);
    return 'updated';
  }
}

export function applyFields(base: ArrField[], desired: Record<string, unknown>): ArrField[] {
  return base.map((f) => (f.name in desired ? { ...f, value: desired[f.name] } : f));
}

export function fieldsDiffer(current: ArrField[], desired: Record<string, unknown>): boolean {
  return Object.entries(desired).some(([name, want]) => {
    const have = current.find((f) => f.name === name)?.value;
    return have !== MASKED && JSON.stringify(have) !== JSON.stringify(want);
  });
}
