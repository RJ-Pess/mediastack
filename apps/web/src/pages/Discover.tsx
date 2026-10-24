import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Compass,
  Plus,
  Sparkles,
  Star,
  TrendingUp,
  Undo2,
  X,
  CalendarClock,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, post } from '../api';
import { useLang, useT } from '../i18n';
import { Button, Empty, ErrorNote, IconTile, PageHeader, Skeleton, Ticket, cx } from '../ui';

interface Item {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: string;
  poster: string | null;
  rating: number | null;
  genreIds: number[];
  mediaStatus: number;
}
interface Row {
  id: 'similar' | 'trending' | 'upcoming-movies' | 'upcoming-tv';
  items: Item[];
}
interface Genre {
  id: number;
  name: string;
}
interface Dismissed {
  key: string;
  title: string;
}

const ROWS: Record<
  Row['id'],
  { title: string; hint: string; icon: typeof Sparkles; color: string }
> = {
  similar: {
    title: 'Parecido com a tua biblioteca',
    hint: 'a partir dos filmes que adicionaste por último',
    icon: Sparkles,
    color: 'var(--c-violet)',
  },
  trending: {
    title: 'Em tendência',
    hint: 'esta semana',
    icon: TrendingUp,
    color: 'var(--c-rose)',
  },
  'upcoming-movies': {
    title: 'Filmes a estrear',
    hint: 'nas próximas semanas',
    icon: CalendarClock,
    color: 'var(--c-amber)',
  },
  'upcoming-tv': {
    title: 'Séries a estrear',
    hint: 'nas próximas semanas',
    icon: CalendarClock,
    color: 'var(--c-sky)',
  },
};

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: currentYear + 2 - 1950 }, (_, i) => currentYear + 1 - i);

/** Bilhete do Descobrir: nota, género · ano, e as ações pedir / não me interessa. */
function DiscoverTicket({
  item,
  genres,
  onRequest,
  onDismiss,
  busy,
}: {
  item: Item;
  genres: Map<number, string>;
  onRequest: (i: Item) => void;
  onDismiss: (i: Item) => void;
  busy: boolean;
}) {
  const t = useT();
  const genre = item.genreIds.map((g) => genres.get(g)).find(Boolean);
  const requested = item.mediaStatus >= 2;
  return (
    <Ticket
      title={item.title}
      poster={item.poster}
      kicker={[genre ?? (item.mediaType === 'movie' ? t('Filme') : t('Série')), item.year]
        .filter(Boolean)
        .join(' · ')}
      corner={
        item.rating ? (
          <>
            <Star className="size-3 fill-current" style={{ color: 'var(--c-amber)' }} aria-hidden />
            <span>
              <span className="sr-only">{t('Nota')} </span>
              {item.rating.toFixed(1)}
            </span>
          </>
        ) : undefined
      }
      badge={
        item.mediaStatus >= 4
          ? { icon: <Check className="size-3" aria-hidden />, label: t('Disponível') }
          : requested
            ? { icon: <Check className="size-3" aria-hidden />, label: t('Pedido') }
            : undefined
      }
      footer={
        <div className="mt-2 flex gap-1.5">
          {requested ? null : (
            <button
              type="button"
              className="btn flex-1 !min-h-8 !py-1 text-xs"
              style={{
                background: 'var(--ticket-text)',
                color: 'var(--ticket)',
                borderColor: 'transparent',
              }}
              onClick={() => onRequest(item)}
              disabled={busy}
            >
              <Plus className="size-3.5" aria-hidden /> {t('Pedir')}
            </button>
          )}
          <button
            type="button"
            className="btn !min-h-8 !w-8 !p-0"
            style={{
              background: 'transparent',
              color: 'var(--ticket-text)',
              borderColor: 'rgba(42,36,24,0.25)',
            }}
            onClick={() => onDismiss(item)}
            aria-label={t('Não me interessa: {title}', { title: item.title })}
            title={t('Não me interessa')}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      }
    />
  );
}

export function Discover() {
  const t = useT();
  const { lang } = useLang();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'forYou' | 'explore'>('forYou');
  const [type, setType] = useState<'movie' | 'tv'>('movie');
  const [genre, setGenre] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [sort, setSort] = useState<'popular' | 'rating' | 'newest'>('popular');
  const [hideOwned, setHideOwned] = useState(true);
  const [showDismissed, setShowDismissed] = useState(false);
  /** Pedidos feitos nesta sessão (para o botão mudar logo, sem esperar pelo Seerr). */
  const [requestedNow, setRequestedNow] = useState<Set<string>>(new Set());

  const movieGenres = useQuery({
    queryKey: ['genres', 'movie', lang],
    queryFn: () => api<Genre[]>(`/api/discover/genres?type=movie&lang=${lang}`),
    staleTime: 3_600_000,
  });
  const tvGenres = useQuery({
    queryKey: ['genres', 'tv', lang],
    queryFn: () => api<Genre[]>(`/api/discover/genres?type=tv&lang=${lang}`),
    staleTime: 3_600_000,
  });
  const genreNames = useMemo(
    () =>
      new Map([...(movieGenres.data ?? []), ...(tvGenres.data ?? [])].map((g) => [g.id, g.name])),
    [movieGenres.data, tvGenres.data],
  );

  const rows = useQuery({
    queryKey: ['discover-rows', hideOwned, lang],
    queryFn: () => api<Row[]>(`/api/discover/rows?hideOwned=${hideOwned ? 1 : 0}&lang=${lang}`),
    enabled: tab === 'forYou',
  });
  const params = new URLSearchParams({ type, sort, hideOwned: hideOwned ? '1' : '0', lang });
  if (genre) params.set('genre', genre);
  if (yearFrom) params.set('yearFrom', yearFrom);
  if (yearTo) params.set('yearTo', yearTo);
  const explore = useInfiniteQuery({
    queryKey: ['discover', params.toString()],
    queryFn: ({ pageParam }) =>
      api<{ items: Item[]; page: number; totalPages: number }>(
        `/api/discover?${params}&page=${pageParam}`,
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: tab === 'explore',
  });
  const dismissed = useQuery({
    queryKey: ['dismissed'],
    queryFn: () => api<Dismissed[]>('/api/discover/dismissed'),
  });

  const refresh = () =>
    Promise.all(
      ['discover-rows', 'discover', 'dismissed'].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );
  const request = useMutation({
    mutationFn: (i: Item) => post('/api/request', { mediaType: i.mediaType, tmdbId: i.tmdbId }),
    onSuccess: (_d, i) => {
      setRequestedNow((s) => new Set(s).add(`${i.mediaType}:${i.tmdbId}`));
      void qc.invalidateQueries({ queryKey: ['requests'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
  const dismiss = useMutation({
    mutationFn: (i: Item) =>
      post('/api/discover/dismissed', { mediaType: i.mediaType, tmdbId: i.tmdbId, title: i.title }),
    onSuccess: refresh,
  });
  const undo = useMutation({
    mutationFn: (key: string) => api(`/api/discover/dismissed/${key}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const withLocal = (i: Item): Item =>
    requestedNow.has(`${i.mediaType}:${i.tmdbId}`) && i.mediaStatus < 2
      ? { ...i, mediaStatus: 2 }
      : i;
  const ticket = (i: Item) => (
    <DiscoverTicket
      key={`${i.mediaType}:${i.tmdbId}`}
      item={withLocal(i)}
      genres={genreNames}
      onRequest={(x) => request.mutate(x)}
      onDismiss={(x) => dismiss.mutate(x)}
      busy={request.isPending}
    />
  );
  const types = type === 'movie' ? movieGenres.data : tvGenres.data;
  const items = explore.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader title={t('Descobrir')} />
      <div className="panel mb-5 flex flex-wrap items-center gap-2 !p-3">
        <div role="tablist" aria-label={t('Descobrir')} className="flex gap-1">
          {(
            [
              ['forYou', 'Para ti', Sparkles],
              ['explore', 'Explorar', Compass],
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
        <label className="ml-auto flex min-h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={hideOwned}
            onChange={(e) => setHideOwned(e.target.checked)}
          />
          {t('Esconder o que já tenho')}
        </label>
        <Button
          variant="ghost"
          onClick={() => setShowDismissed((v) => !v)}
          aria-expanded={showDismissed}
        >
          {t('Não me interessa ({n})', { n: dismissed.data?.length ?? 0 })}
        </Button>
      </div>

      <ErrorNote error={rows.error ?? explore.error ?? request.error ?? dismiss.error} />

      {showDismissed && (
        <section className="panel mb-5" aria-label={t('Não me interessa')}>
          {dismissed.data?.length ? (
            <ul className="flex flex-wrap gap-2">
              {dismissed.data.map((d) => (
                <li key={d.key}>
                  <button className="chip" onClick={() => undo.mutate(d.key)}>
                    <Undo2 className="size-3.5" aria-hidden /> {d.title || d.key}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted text-sm">{t('Ainda não dispensaste nenhum título.')}</p>
          )}
        </section>
      )}

      {tab === 'forYou' ? (
        rows.isLoading ? (
          <div className="space-y-5">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-80" />
            ))}
          </div>
        ) : rows.data?.length ? (
          <div className="space-y-5">
            {rows.data.map((row) => {
              const meta = ROWS[row.id];
              return (
                <section key={row.id} className="panel min-w-0" aria-label={t(meta.title)}>
                  <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <IconTile icon={meta.icon} color={meta.color} />
                    <h2 className="text-lg font-semibold">{t(meta.title)}</h2>
                    <span className="muted text-sm">{t(meta.hint)}</span>
                  </div>
                  <div className="ticket-row">{row.items.map(ticket)}</div>
                </section>
              );
            })}
          </div>
        ) : (
          <Empty>{t('Sem sugestões por agora. Adiciona alguns filmes à biblioteca.')}</Empty>
        )
      ) : (
        <>
          <div className="panel mb-5 flex flex-wrap items-end gap-3 !p-3">
            <div className="flex gap-1" role="group" aria-label={t('Tipo')}>
              {(
                [
                  ['movie', 'Filmes'],
                  ['tv', 'Séries'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={cx('btn', type === id ? 'btn-primary' : 'btn-ghost')}
                  aria-pressed={type === id}
                  onClick={() => {
                    setType(id);
                    setGenre('');
                  }}
                >
                  {t(label)}
                </button>
              ))}
            </div>
            <label className="text-sm">
              <span className="muted mb-1 block text-xs">{t('Género')}</span>
              <select
                className="input !w-auto"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
              >
                <option value="">{t('Todos os géneros')}</option>
                {types?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="muted mb-1 block text-xs">{t('Desde')}</span>
              <select
                className="input !w-auto"
                value={yearFrom}
                onChange={(e) => setYearFrom(e.target.value)}
              >
                <option value="">—</option>
                {YEARS.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="muted mb-1 block text-xs">{t('Até')}</span>
              <select
                className="input !w-auto"
                value={yearTo}
                onChange={(e) => setYearTo(e.target.value)}
              >
                <option value="">—</option>
                {YEARS.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="muted mb-1 block text-xs">{t('Ordenar')}</span>
              <select
                className="input !w-auto"
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
              >
                <option value="popular">{t('Mais populares')}</option>
                <option value="rating">{t('Melhor avaliados')}</option>
                <option value="newest">{t('Mais recentes')}</option>
              </select>
            </label>
          </div>
          {explore.isLoading ? (
            <Skeleton className="h-96" />
          ) : items.length ? (
            <>
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                {items.map((i) => (
                  <li key={`${i.mediaType}:${i.tmdbId}`}>{ticket(i)}</li>
                ))}
              </ul>
              {explore.hasNextPage && (
                <div className="mt-5 flex justify-center">
                  <Button
                    onClick={() => void explore.fetchNextPage()}
                    disabled={explore.isFetchingNextPage}
                  >
                    <Plus className="size-4" aria-hidden /> {t('Carregar mais')}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <Empty>{t('Nada encontrado com estes filtros.')}</Empty>
          )}
        </>
      )}
    </>
  );
}
