import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Download, History, Pause, Play, Trash2, Undo2 } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { api, fmtBytes, fmtEta, post } from '../api';
import { useLang, useT } from '../i18n';
import { Button, Empty, ErrorNote, Meter, PageHeader, Skeleton, cx } from '../ui';

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
interface HistoryEntry {
  service: string;
  date: string;
  event: 'grabbed' | 'imported' | 'failed' | 'deleted' | 'renamed' | 'other';
  title: string;
  sourceTitle: string;
}
interface BlockEntry {
  service: 'sonarr' | 'radarr';
  id: number;
  date: string;
  title: string;
  sourceTitle: string;
  message?: string;
}
const paused = (s: string) => /paused|stopped/i.test(s);
const EVENT_LABEL: Record<HistoryEntry['event'], string> = {
  grabbed: 'Apanhado',
  imported: 'Importado',
  failed: 'Falhou',
  deleted: 'Apagado',
  renamed: 'Renomeado',
  other: 'Outro',
};
const EVENT_COLOR: Record<HistoryEntry['event'], string> = {
  grabbed: 'var(--c-sky)',
  imported: 'var(--c-emerald)',
  failed: 'var(--c-rose)',
  deleted: 'var(--c-amber)',
  renamed: 'var(--c-violet)',
  other: 'var(--c-slate)',
};

export function Activity() {
  const t = useT();
  const { locale } = useLang();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'now' | 'history' | 'blocklist'>('now');
  const q = useQuery({
    queryKey: ['activity'],
    queryFn: () => api<Item[]>('/api/activity'),
    refetchInterval: 3_000,
    enabled: tab === 'now',
  });
  const hist = useQuery({
    queryKey: ['activity-history'],
    queryFn: () => api<HistoryEntry[]>('/api/activity/history'),
    enabled: tab === 'history',
  });
  const blocks = useQuery({
    queryKey: ['activity-blocklist'],
    queryFn: () => api<BlockEntry[]>('/api/activity/blocklist'),
    enabled: tab === 'blocklist',
  });
  const act = useMutation({
    mutationFn: ({ hash, action }: { hash: string; action: string }) =>
      post(`/api/activity/${hash}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activity'] }),
  });
  const unblock = useMutation({
    mutationFn: (b: BlockEntry) =>
      api(`/api/activity/blocklist/${b.service}/${b.id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activity-blocklist'] }),
  });
  const when = (d: string) =>
    new Date(d).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });

  return (
    <>
      <PageHeader title={t('Atividade')} />
      <div
        role="tablist"
        aria-label={t('Atividade')}
        className="panel mb-5 flex flex-wrap gap-1 !p-3"
      >
        {(
          [
            ['now', 'Agora', Download],
            ['history', 'Histórico', History],
            ['blocklist', 'Bloqueados', Ban],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={cx('btn', tab === id ? 'btn-primary' : 'btn-ghost')}
            onClick={() => setTab(id)}
          >
            <Icon className="size-4" aria-hidden /> {t(label)}
          </button>
        ))}
      </div>
      <ErrorNote error={q.error ?? act.error ?? hist.error ?? blocks.error ?? unblock.error} />

      {tab === 'now' &&
        (q.isLoading ? (
          <Skeleton className="h-40" />
        ) : q.data?.length ? (
          <ul className="space-y-3">
            {q.data.map((a) => (
              <li key={a.id} className="panel">
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
                        aria-label={
                          paused(a.state)
                            ? t('Retomar {title}', { title: a.title })
                            : t('Pausar {title}', { title: a.title })
                        }
                        onClick={() =>
                          act.mutate({
                            hash: a.hash!,
                            action: paused(a.state) ? 'resume' : 'pause',
                          })
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
                        aria-label={t('Remover {title}', { title: a.title })}
                        onClick={() =>
                          window.confirm(
                            t('Remover "{title}" (os ficheiros ficam)?', { title: a.title }),
                          ) && act.mutate({ hash: a.hash!, action: 'delete' })
                        }
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="my-2">
                  <Meter value={a.progress} label={t('Progresso de {title}', { title: a.title })} />
                </div>
                <p className="muted mono text-xs">
                  {Math.round(a.progress * 100)}% · {fmtBytes(a.downBps)}/s · {t('ETA')}{' '}
                  {fmtEta(a.etaSec)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t('Sem downloads em curso.')}</Empty>
        ))}

      {tab === 'history' &&
        (hist.isLoading ? (
          <Skeleton className="h-40" />
        ) : hist.data?.length ? (
          <ul className="panel divide-y !p-0" style={{ borderColor: 'var(--border)' }}>
            {hist.data.map((h, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
                style={{ borderColor: 'var(--border)' }}
              >
                <span
                  className="chip !min-h-7 !py-0.5 text-xs"
                  style={{ '--chip': EVENT_COLOR[h.event] } as CSSProperties}
                >
                  {t(EVENT_LABEL[h.event])}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{h.title}</span>
                  <span className="muted mono block truncate text-xs">{h.sourceTitle}</span>
                </span>
                <time className="muted mono text-xs" dateTime={h.date}>
                  {when(h.date)}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t('Ainda não há histórico.')}</Empty>
        ))}

      {tab === 'blocklist' &&
        (blocks.isLoading ? (
          <Skeleton className="h-40" />
        ) : blocks.data?.length ? (
          <ul className="space-y-2">
            {blocks.data.map((b) => (
              <li
                key={`${b.service}${b.id}`}
                className="panel flex flex-wrap items-center gap-3 !p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{b.title}</span>
                  <span className="muted mono block truncate text-xs">{b.sourceTitle}</span>
                  {b.message && <span className="muted block text-xs">{b.message}</span>}
                </span>
                <time className="muted mono text-xs" dateTime={b.date}>
                  {when(b.date)}
                </time>
                <Button onClick={() => unblock.mutate(b)} disabled={unblock.isPending}>
                  <Undo2 className="size-4" aria-hidden /> {t('Desbloquear')}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t('Nenhum release bloqueado.')}</Empty>
        ))}
    </>
  );
}
