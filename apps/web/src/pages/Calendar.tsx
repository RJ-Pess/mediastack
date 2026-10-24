import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Clapperboard, ListTodo, Tv } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { useLang, useT } from '../i18n';
import { Button, Empty, ErrorNote, PageHeader, Skeleton, cx } from '../ui';

interface Item {
  date: string;
  kind: 'episode' | 'movie';
  title: string;
  subtitle?: string;
  hasFile: boolean;
}
interface Wanted {
  kind: 'movie' | 'episode';
  title: string;
  detail?: string;
  date?: string;
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Grelha do mês: começa na segunda-feira da semana do dia 1 (6 semanas). */
function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(1 - offset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function Calendar() {
  const t = useT();
  const { locale } = useLang();
  const [tab, setTab] = useState<'month' | 'wanted'>('month');
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const days = monthGrid(month);
  const q = useQuery({
    queryKey: ['calendar-month', iso(days[0]!)],
    queryFn: () => api<Item[]>(`/api/calendar?start=${iso(days[0]!)}&days=42`),
    enabled: tab === 'month',
  });
  const wanted = useQuery({
    queryKey: ['wanted'],
    queryFn: () => api<Wanted[]>('/api/wanted'),
    enabled: tab === 'wanted',
  });
  const byDay = new Map<string, Item[]>();
  for (const i of q.data ?? []) {
    const k = iso(new Date(i.date));
    byDay.set(k, [...(byDay.get(k) ?? []), i]);
  }
  const today = iso(new Date());
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }),
  );

  return (
    <>
      <PageHeader title={t('Calendário')} />
      <div className="panel mb-5 flex flex-wrap items-center gap-2 !p-3">
        <div role="tablist" aria-label={t('Calendário')} className="flex gap-1">
          {(
            [
              ['month', 'Mês', CalendarDays],
              ['wanted', 'Em falta', ListTodo],
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
        {tab === 'month' && (
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              aria-label={t('Mês anterior')}
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <span className="min-w-36 text-center font-semibold capitalize">
              {month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
            </span>
            <Button
              variant="ghost"
              aria-label={t('Mês seguinte')}
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        )}
      </div>
      <ErrorNote error={q.error ?? wanted.error} />

      {tab === 'month' ? (
        q.isLoading ? (
          <Skeleton className="h-[32rem]" />
        ) : (
          <div className="panel overflow-x-auto !p-2">
            <div className="grid min-w-[42rem] grid-cols-7 gap-1">
              {weekdays.map((w) => (
                <div key={w} className="muted p-1 text-center text-xs font-semibold uppercase">
                  {w}
                </div>
              ))}
              {days.map((d) => {
                const k = iso(d);
                const items = byDay.get(k) ?? [];
                const inMonth = d.getMonth() === month.getMonth();
                return (
                  <div
                    key={k}
                    className={cx('min-h-24 rounded-lg p-1.5 text-xs', !inMonth && 'opacity-40')}
                    style={{
                      background: 'var(--surface-2)',
                      boxShadow: k === today ? 'inset 0 0 0 2px var(--accent)' : undefined,
                    }}
                  >
                    <p className={cx('mb-1 font-semibold', k === today && 'text-[var(--accent)]')}>
                      {d.getDate()}
                    </p>
                    <ul className="space-y-1">
                      {items.slice(0, 3).map((i, n) => (
                        <li
                          key={n}
                          className="flex items-center gap-1 truncate rounded px-1 py-0.5"
                          style={{
                            background: `color-mix(in srgb, ${i.kind === 'movie' ? 'var(--c-amber)' : 'var(--c-sky)'} 18%, transparent)`,
                          }}
                          title={i.subtitle ? `${i.title} · ${i.subtitle}` : i.title}
                        >
                          {i.kind === 'movie' ? (
                            <Clapperboard className="size-3 shrink-0" aria-label={t('Filme')} />
                          ) : (
                            <Tv className="size-3 shrink-0" aria-label={t('Episódio')} />
                          )}
                          <span className="truncate">{i.title}</span>
                        </li>
                      ))}
                      {items.length > 3 && <li className="muted">+{items.length - 3}</li>}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        )
      ) : wanted.isLoading ? (
        <Skeleton className="h-40" />
      ) : wanted.data?.length ? (
        <ul className="panel divide-y !p-0">
          {wanted.data.map((w, i) => (
            <li
              key={i}
              className="flex items-center gap-3 px-4 py-3"
              style={{ borderColor: 'var(--border)' }}
            >
              {w.kind === 'movie' ? (
                <Clapperboard
                  className="size-5 shrink-0"
                  style={{ color: 'var(--c-amber)' }}
                  aria-label={t('Filme')}
                />
              ) : (
                <Tv
                  className="size-5 shrink-0"
                  style={{ color: 'var(--c-sky)' }}
                  aria-label={t('Episódio')}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{w.title}</span>
                {w.detail && <span className="muted block truncate text-sm">{w.detail}</span>}
              </span>
              {w.date && (
                <time className="muted mono text-xs" dateTime={w.date}>
                  {new Date(w.date).toLocaleDateString(locale)}
                </time>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t('Nada em falta.')}</Empty>
      )}
    </>
  );
}
