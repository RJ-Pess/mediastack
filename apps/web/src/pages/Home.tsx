import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, fmtBytes } from '../api';
import { Card, Dot, PageHeader, Skeleton } from '../ui';

interface ServiceStatus {
  id: string;
  name: string;
  state: 'up' | 'down';
  latencyMs: number | null;
  detail?: string;
}
interface Activity {
  id: string;
  title: string;
  progress: number;
  downBps: number;
}
interface Cal {
  date: string;
  title: string;
  subtitle?: string;
}
interface Drift {
  changes: unknown[];
}

export function Home() {
  const status = useQuery({
    queryKey: ['status'],
    queryFn: () => api<{ services: ServiceStatus[] }>('/api/status'),
    refetchInterval: 10_000,
  });
  const activity = useQuery({
    queryKey: ['activity'],
    queryFn: () => api<Activity[]>('/api/activity'),
    refetchInterval: 5_000,
  });
  const cal = useQuery({ queryKey: ['calendar'], queryFn: () => api<Cal[]>('/api/calendar') });
  const drift = useQuery({
    queryKey: ['drift'],
    queryFn: () => api<Drift>('/api/drift'),
    refetchInterval: 60_000,
  });
  const speed = activity.data?.reduce((n, a) => n + a.downBps, 0) ?? 0;

  return (
    <>
      <PageHeader title="Início" />
      {drift.data && drift.data.changes.length > 0 && (
        <Link to="/definicoes" className="card mb-4 block" style={{ borderColor: 'var(--warn)' }}>
          <Dot state="warn" /> {drift.data.changes.length} definições foram alteradas fora do Cais.
          Rever em Definições.
        </Link>
      )}
      <h2 className="muted mb-3 text-sm font-medium uppercase tracking-wide">Serviços</h2>
      <ul className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {status.isLoading
          ? Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-16" />)
          : status.data?.services.map((s) => (
              <li key={s.id} className="card flex items-center gap-3 !p-3">
                <Dot state={s.state === 'up' ? 'ok' : 'bad'} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="muted truncate text-xs">
                    {s.state === 'up' ? `${s.latencyMs} ms` : (s.detail ?? 'Sem resposta')}
                  </p>
                </div>
              </li>
            ))}
      </ul>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Atividade</h2>
            <span className="muted text-sm">{fmtBytes(speed)}/s</span>
          </div>
          {activity.isLoading ? (
            <Skeleton className="h-24" />
          ) : activity.data?.length ? (
            <ul className="space-y-3">
              {activity.data.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <p className="truncate text-sm">{a.title}</p>
                  <div
                    className="bar"
                    role="progressbar"
                    aria-valuenow={Math.round(a.progress * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Progresso de ${a.title}`}
                  >
                    <span style={{ width: `${a.progress * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Sem downloads ativos.</p>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Próximos lançamentos</h2>
          {cal.isLoading ? (
            <Skeleton className="h-24" />
          ) : cal.data?.length ? (
            <ul className="space-y-2 text-sm">
              {cal.data.slice(0, 6).map((c, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="truncate">
                    {c.title}
                    {c.subtitle && <span className="muted"> · {c.subtitle}</span>}
                  </span>
                  <time className="muted shrink-0" dateTime={c.date}>
                    {new Date(c.date).toLocaleDateString('pt-PT')}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nada agendado nas próximas semanas.</p>
          )}
        </Card>
      </div>
    </>
  );
}
