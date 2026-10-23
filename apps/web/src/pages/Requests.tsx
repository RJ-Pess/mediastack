import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post } from '../api';
import { Button, Empty, ErrorNote, PageHeader, Poster, Skeleton } from '../ui';

interface Req {
  id: number;
  status: number;
  mediaType: string;
  title: string;
  poster: string | null;
  requestedBy: string;
  createdAt: string;
}
const STATUS: Record<number, string> = { 1: 'Pendente', 2: 'Aprovado', 3: 'Recusado' };

export function Requests() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['requests'],
    queryFn: () => api<Req[]>('/api/requests'),
    refetchInterval: 15_000,
  });
  const approve = useMutation({
    mutationFn: (id: number) => post(`/api/requests/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests'] }),
  });
  return (
    <>
      <PageHeader title="Pedidos" />
      <ErrorNote error={q.error ?? approve.error} />
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.data?.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {q.data.map((r) => (
            <li key={r.id} className="card flex gap-3 !p-3">
              <div className="w-16 shrink-0">
                <Poster src={r.poster} title={r.title} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.title}</p>
                <p className="muted text-sm">
                  {r.mediaType === 'movie' ? 'Filme' : 'Série'} · {r.requestedBy}
                </p>
                <p className="muted text-xs">{new Date(r.createdAt).toLocaleDateString('pt-PT')}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-sm">{STATUS[r.status] ?? r.status}</span>
                  {r.status === 1 && (
                    <Button
                      variant="primary"
                      onClick={() => approve.mutate(r.id)}
                      disabled={approve.isPending}
                    >
                      Aprovar
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Ainda não há pedidos. Usa ⌘K para pedir um filme ou série.</Empty>
      )}
    </>
  );
}
