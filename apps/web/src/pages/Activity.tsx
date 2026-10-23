import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Trash2 } from 'lucide-react';
import { api, fmtBytes, fmtEta, post } from '../api';
import { Button, Empty, ErrorNote, PageHeader, Skeleton } from '../ui';

interface Item {
  id: string;
  source: string;
  title: string;
  progress: number;
  downBps: number;
  etaSec: number | null;
  state: string;
  hash?: string;
}
const paused = (s: string) => /paused|stopped/i.test(s);

export function Activity() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['activity'],
    queryFn: () => api<Item[]>('/api/activity'),
    refetchInterval: 3_000,
  });
  const act = useMutation({
    mutationFn: ({ hash, action }: { hash: string; action: string }) =>
      post(`/api/activity/${hash}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activity'] }),
  });
  return (
    <>
      <PageHeader title="Atividade" />
      <ErrorNote error={q.error ?? act.error} />
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.data?.length ? (
        <ul className="space-y-3">
          {q.data.map((a) => (
            <li key={a.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.title}</p>
                  <p className="muted text-xs">
                    {a.source} · {a.state}
                  </p>
                </div>
                {a.hash && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      aria-label={paused(a.state) ? `Retomar ${a.title}` : `Pausar ${a.title}`}
                      onClick={() =>
                        act.mutate({ hash: a.hash!, action: paused(a.state) ? 'resume' : 'pause' })
                      }
                    >
                      {paused(a.state) ? (
                        <Play className="size-4" aria-hidden />
                      ) : (
                        <Pause className="size-4" aria-hidden />
                      )}
                    </Button>
                    <Button
                      variant="danger"
                      aria-label={`Remover ${a.title}`}
                      onClick={() =>
                        window.confirm(`Remover "${a.title}" (os ficheiros ficam)?`) &&
                        act.mutate({ hash: a.hash!, action: 'delete' })
                      }
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
              <div
                className="bar my-2"
                role="progressbar"
                aria-valuenow={Math.round(a.progress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Progresso de ${a.title}`}
              >
                <span style={{ width: `${a.progress * 100}%` }} />
              </div>
              <p className="muted text-xs">
                {Math.round(a.progress * 100)}% · {fmtBytes(a.downBps)}/s · ETA {fmtEta(a.etaSec)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Sem downloads em curso.</Empty>
      )}
    </>
  );
}
