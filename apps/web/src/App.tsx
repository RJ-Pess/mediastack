import { useQuery } from '@tanstack/react-query';
import { Anchor, CircleAlert, CircleCheck } from 'lucide-react';

interface ServiceStatus {
  id: string;
  name: string;
  state: 'up' | 'down';
  latencyMs: number | null;
  detail?: string;
}

async function fetchStatus(): Promise<ServiceStatus[]> {
  const res = await fetch('/api/status');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { services: ServiceStatus[] }).services;
}

export function App() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    refetchInterval: 10_000,
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex items-center gap-3">
        <Anchor className="size-7" style={{ color: 'var(--accent)' }} aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">Cais</h1>
      </header>

      <h2
        className="mb-4 text-sm font-medium uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        Estado dos serviços
      </h2>

      {error && (
        <p role="alert" className="mb-4 text-red-400">
          Não foi possível obter o estado: {error.message}
        </p>
      )}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading
          ? Array.from({ length: 7 }, (_, i) => (
              <li
                key={i}
                className="h-20 animate-pulse rounded-xl"
                style={{ background: 'var(--surface)' }}
              />
            ))
          : data?.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-xl border p-4"
                style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>
                    {s.state === 'up' ? `${s.latencyMs} ms` : (s.detail ?? 'Sem resposta')}
                  </p>
                </div>
                {s.state === 'up' ? (
                  <CircleCheck className="size-6 text-emerald-400" aria-label="Disponível" />
                ) : (
                  <CircleAlert className="size-6 text-red-400" aria-label="Indisponível" />
                )}
              </li>
            ))}
      </ul>
    </main>
  );
}
