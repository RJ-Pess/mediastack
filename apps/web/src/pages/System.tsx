import { useQuery } from '@tanstack/react-query';
import { api, fmtBytes } from '../api';
import { useT } from '../i18n';
import { Card, Dot, ErrorNote, PageHeader, Skeleton } from '../ui';

interface Sys {
  services: {
    id: string;
    name: string;
    version: string | null;
    health: { type: string; message: string }[];
  }[];
  disks: { path: string; freeSpace: number; totalSpace: number }[];
}

export function System() {
  const t = useT();
  const q = useQuery({
    queryKey: ['system'],
    queryFn: () => api<Sys>('/api/system'),
    refetchInterval: 30_000,
  });
  return (
    <>
      <PageHeader title={t('Sistema')} />
      <ErrorNote error={q.error} />
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        q.data && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              {q.data.services.map((s) => (
                <Card key={s.id}>
                  <p className="font-semibold">{s.name}</p>
                  <p className="muted text-sm">{s.version ? `v${s.version}` : t('indisponível')}</p>
                  <ul className="mt-3 space-y-2 text-sm">
                    {s.health.length ? (
                      s.health.map((h, i) => (
                        <li key={i} className="flex gap-2">
                          <Dot state={h.type === 'error' ? 'bad' : 'warn'} />
                          <span>{h.message}</span>
                        </li>
                      ))
                    ) : (
                      <li className="flex gap-2">
                        <Dot state="ok" /> {t('Sem avisos')}
                      </li>
                    )}
                  </ul>
                </Card>
              ))}
            </div>
            <Card>
              <h2 className="mb-3 font-semibold">{t('Espaço em disco')}</h2>
              <ul className="space-y-3">
                {q.data.disks.map((d) => {
                  const used = d.totalSpace ? 1 - d.freeSpace / d.totalSpace : 0;
                  return (
                    <li key={d.path}>
                      <p className="text-sm">
                        {d.path}{' '}
                        <span className="muted">
                          ·{' '}
                          {t('livre {free} de {total}', {
                            free: fmtBytes(d.freeSpace),
                            total: fmtBytes(d.totalSpace),
                          })}
                        </span>
                      </p>
                      <div
                        className="bar"
                        role="progressbar"
                        aria-valuenow={Math.round(used * 100)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={t('Ocupação de {path}', { path: d.path })}
                      >
                        <span style={{ width: `${used * 100}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        )
      )}
    </>
  );
}
