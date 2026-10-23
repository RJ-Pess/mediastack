import { useQuery } from '@tanstack/react-query';
import { Clapperboard, Tv } from 'lucide-react';
import { api } from '../api';
import { useLang, useT } from '../i18n';
import { Empty, ErrorNote, PageHeader, Skeleton } from '../ui';

interface Item {
  date: string;
  kind: 'episode' | 'movie';
  title: string;
  subtitle?: string;
  hasFile: boolean;
}

export function Calendar() {
  const t = useT();
  const { locale } = useLang();
  const q = useQuery({ queryKey: ['calendar'], queryFn: () => api<Item[]>('/api/calendar') });
  const byDay = new Map<string, Item[]>();
  for (const i of q.data ?? []) {
    const k = new Date(i.date).toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    byDay.set(k, [...(byDay.get(k) ?? []), i]);
  }
  return (
    <>
      <PageHeader title={t('Calendário')} />
      <ErrorNote error={q.error} />
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : byDay.size ? (
        <div className="space-y-6">
          {[...byDay].map(([day, items]) => (
            <section key={day} aria-label={day}>
              <h2 className="muted mb-2 text-sm font-medium capitalize">{day}</h2>
              <ul className="space-y-2">
                {items.map((i, n) => (
                  <li key={n} className="card flex items-center gap-3 !p-3">
                    {i.kind === 'episode' ? (
                      <Tv className="size-5 shrink-0" aria-label={t('Episódio')} />
                    ) : (
                      <Clapperboard className="size-5 shrink-0" aria-label={t('Filme')} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{i.title}</p>
                      {i.subtitle && <p className="muted truncate text-sm">{i.subtitle}</p>}
                    </div>
                    {i.hasFile && (
                      <span className="text-xs" style={{ color: 'var(--ok)' }}>
                        {t('Disponível')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <Empty>{t('Nada agendado nas próximas três semanas.')}</Empty>
      )}
    </>
  );
}
