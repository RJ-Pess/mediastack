export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body:
      init?.body !== undefined
        ? JSON.stringify(init.body)
        : init?.method === 'POST'
          ? '{}'
          : undefined,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* corpo não é JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });

export const fmtBytes = (n: number) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
};

export const fmtEta = (s: number | null) => {
  if (s === null) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
};
