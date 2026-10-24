import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CheckCircle2,
  Clapperboard,
  Download,
  Inbox,
  Server,
  ShieldAlert,
  Sparkles,
  Tv,
  Bookmark,
  Clock,
  CircleDashed,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtBytes } from '../api';
import { useLang, useT, type T } from '../i18n';
import { Dot, IconTile, Meter, PageHeader, Skeleton, Ticket } from '../ui';

interface PosterItem {
  key: string;
  kind: 'movie' | 'series';
  title: string;
  year: number | null;
  poster: string | null;
  detail?: string;
  badge?: 'downloading' | 'missing' | 'available';
  progress?: number;
}
interface Overview {
  counts: {
    downloading: number;
    queued: number;
    missing: number;
    healthIssues: number;
    pendingRequests: number | null;
  };
  server: {
    cpuPct: number | null;
    memUsed: number | null;
    memTotal: number | null;
    diskUsed: number | null;
    diskTotal: number | null;
  };
  media: {
    movies: { total: number; downloaded: number; missing: number } | null;
    series: { total: number; episodes: number; episodesTotal: number } | null;
  };
  recent: PosterItem[];
  upcoming: PosterItem[];
}
interface ServiceStatus {
  state: 'up' | 'down';
}
interface Cal {
  date: string;
  title: string;
  subtitle?: string;
}

const greeting = (t: T, user: string) => {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return t('Bom dia, {user}', { user });
  if (h >= 12 && h < 20) return t('Boa tarde, {user}', { user });
  return t('Boa noite, {user}', { user });
};

function Chip({
  to,
  color,
  icon,
  children,
}: {
  to: string;
  color: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link to={to} className="chip" style={{ '--chip': color } as CSSProperties}>
      {icon}
      {children}
    </Link>
  );
}

function StatCard({
  icon,
  color,
  label,
  value,
  caption,
  to,
}: {
  icon: Parameters<typeof IconTile>[0]['icon'];
  color: string;
  label: string;
  value: ReactNode;
  caption: string;
  to: string;
}) {
  return (
    <Link to={to} className="panel block transition-transform hover:-translate-y-0.5">
      <div className="flex items-center gap-3">
        <IconTile icon={icon} color={color} large />
        <span className="font-semibold">{label}</span>
      </div>
      <p className="mt-4 text-4xl font-bold tracking-tight">{value}</p>
      <p className="muted mono mt-1 text-xs">{caption}</p>
    </Link>
  );
}

function PosterRow({ items, empty }: { items: PosterItem[]; empty: string }) {
  const t = useT();
  if (!items.length) return <p className="muted py-6 text-sm">{empty}</p>;
  return (
    <div className="ticket-row">
      {items.map((p) => (
        <Ticket
          key={p.key}
          title={p.title}
          poster={p.poster}
          kicker={[p.kind === 'movie' ? t('Filme') : t('Série'), p.detail ?? p.year]
            .filter(Boolean)
            .join(' · ')}
          progress={p.badge === 'downloading' ? p.progress : undefined}
          badge={
            p.badge === 'downloading'
              ? {
                  icon: <Download className="size-3" aria-hidden />,
                  label: t('A descarregar {pct}%', { pct: Math.round((p.progress ?? 0) * 100) }),
                }
              : p.badge === 'missing'
                ? { icon: <CircleDashed className="size-3" aria-hidden />, label: t('Em falta') }
                : p.badge === 'available'
                  ? {
                      icon: <CheckCircle2 className="size-3" aria-hidden />,
                      label: t('Disponível'),
                    }
                  : undefined
          }
        />
      ))}
    </div>
  );
}

function Section({
  icon,
  color,
  title,
  to,
  linkLabel,
  children,
}: {
  icon: Parameters<typeof IconTile>[0]['icon'];
  color: string;
  title: string;
  to: string;
  linkLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="panel min-w-0" aria-label={title}>
      <div className="mb-3 flex items-center gap-3">
        <IconTile icon={icon} color={color} />
        <h2 className="text-lg font-semibold">{title}</h2>
        <Link
          to={to}
          className="ml-auto flex items-center gap-1 text-sm font-medium"
          style={{ color }}
        >
          {linkLabel} <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      {children}
    </section>
  );
}

export function Home() {
  const t = useT();
  const { locale } = useLang();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: string | null }>('/api/auth/me'),
  });
  const ov = useQuery({
    queryKey: ['overview'],
    queryFn: () => api<Overview>('/api/overview'),
    refetchInterval: 15_000,
  });
  const status = useQuery({
    queryKey: ['status'],
    queryFn: () => api<{ services: ServiceStatus[] }>('/api/status'),
    refetchInterval: 15_000,
  });
  const drift = useQuery({
    queryKey: ['drift'],
    queryFn: () => api<{ changes: unknown[] }>('/api/drift'),
    refetchInterval: 60_000,
  });
  const cal = useQuery({ queryKey: ['calendar'], queryFn: () => api<Cal[]>('/api/calendar') });

  const o = ov.data;
  const up = status.data?.services.filter((s) => s.state === 'up').length ?? 0;
  const total = status.data?.services.length ?? 0;
  const driftCount = drift.data?.changes.length ?? 0;
  const s = o?.server;

  return (
    <>
      <PageHeader title={t('Início')} />

      {/* Saudação + servidor */}
      <section className="panel panel-lg mb-5 grid gap-6 overflow-hidden lg:grid-cols-[1fr_22rem]">
        <div>
          <h2 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
            {greeting(t, me.data?.user ?? '')}
          </h2>
          <p className="muted mt-3 text-base">
            {!o
              ? t('A ver o estado da tua stack…')
              : o.counts.downloading
                ? t('{n} downloads em curso, {q} em fila.', {
                    n: o.counts.downloading,
                    q: o.counts.queued,
                  })
                : t('Nada a descarregar neste momento.')}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {o && (
              <>
                <Chip
                  to="/atividade"
                  color="var(--c-sky)"
                  icon={<Download className="size-4" aria-hidden />}
                >
                  {t('{n} a descarregar', { n: o.counts.downloading })}
                </Chip>
                <Chip
                  to="/calendario"
                  color="var(--c-amber)"
                  icon={<Bookmark className="size-4" aria-hidden />}
                >
                  {t('{n} em falta', { n: o.counts.missing })}
                </Chip>
                {o.counts.healthIssues ? (
                  <Chip
                    to="/sistema"
                    color="var(--c-rose)"
                    icon={<ShieldAlert className="size-4" aria-hidden />}
                  >
                    {o.counts.healthIssues === 1
                      ? t('{n} aviso', { n: 1 })
                      : t('{n} avisos', { n: o.counts.healthIssues })}
                  </Chip>
                ) : (
                  <Chip
                    to="/sistema"
                    color="var(--c-emerald)"
                    icon={<CheckCircle2 className="size-4" aria-hidden />}
                  >
                    {t('Tudo em ordem')}
                  </Chip>
                )}
                {o.counts.pendingRequests ? (
                  <Chip
                    to="/pedidos"
                    color="var(--c-violet)"
                    icon={<Inbox className="size-4" aria-hidden />}
                  >
                    {o.counts.pendingRequests === 1
                      ? t('{n} pedido por aprovar', { n: 1 })
                      : t('{n} pedidos por aprovar', { n: o.counts.pendingRequests })}
                  </Chip>
                ) : null}
                {driftCount ? (
                  <Chip
                    to="/definicoes"
                    color="var(--c-amber)"
                    icon={<Sparkles className="size-4" aria-hidden />}
                  >
                    {driftCount === 1
                      ? t('{n} alteração fora do MediaStack', { n: 1 })
                      : t('{n} alterações fora do MediaStack', { n: driftCount })}
                  </Chip>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div
          className="rounded-2xl border p-4"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
        >
          <div className="mb-3 flex items-center gap-2">
            <IconTile icon={Server} color="var(--c-teal)" />
            <h3 className="font-semibold">{t('Servidor')}</h3>
            <span className="ml-auto flex items-center gap-2 text-xs">
              <Dot state={total && up === total ? 'ok' : up ? 'warn' : 'idle'} />
              <span className="muted mono">{t('{up}/{total} serviços', { up, total })}</span>
            </span>
          </div>
          {!s ? (
            <Skeleton className="h-24" />
          ) : (
            <dl className="space-y-3 text-sm">
              <div>
                <div className="flex justify-between">
                  <dt>{t('CPU')}</dt>
                  <dd className="mono">{s.cpuPct === null ? '—' : `${s.cpuPct}%`}</dd>
                </div>
                {s.cpuPct !== null && <Meter value={s.cpuPct / 100} label={t('CPU')} tone="ok" />}
              </div>
              <div>
                <div className="flex justify-between gap-2">
                  <dt>{t('Memória')}</dt>
                  <dd className="mono">
                    {s.memUsed === null || s.memTotal === null
                      ? '—'
                      : t('{used} de {total}', {
                          used: fmtBytes(s.memUsed),
                          total: fmtBytes(s.memTotal),
                        })}
                  </dd>
                </div>
                {s.memUsed !== null && s.memTotal ? (
                  <Meter value={s.memUsed / s.memTotal} label={t('Memória')} tone="ok" />
                ) : null}
              </div>
              <div>
                <div className="flex justify-between gap-2">
                  <dt>{t('Disco')}</dt>
                  <dd className="mono">
                    {s.diskUsed === null || s.diskTotal === null
                      ? '—'
                      : t('{free} livres', { free: fmtBytes(s.diskTotal - s.diskUsed) })}
                  </dd>
                </div>
                {s.diskUsed !== null && s.diskTotal ? (
                  <Meter
                    value={s.diskUsed / s.diskTotal}
                    label={t('Disco')}
                    tone={s.diskUsed / s.diskTotal > 0.9 ? 'warn' : 'ok'}
                  />
                ) : null}
              </div>
            </dl>
          )}
        </div>
      </section>

      {/* Cartões por tipo */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {!o ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-36" />)
        ) : (
          <>
            <StatCard
              to="/biblioteca"
              icon={Clapperboard}
              color="var(--c-sky)"
              label={t('Filmes')}
              value={o.media.movies?.total ?? '—'}
              caption={
                o.media.movies
                  ? t('{d} no disco · {m} em falta', {
                      d: o.media.movies.downloaded,
                      m: o.media.movies.missing,
                    })
                  : t('Radarr indisponível')
              }
            />
            <StatCard
              to="/biblioteca"
              icon={Tv}
              color="var(--c-rose)"
              label={t('Séries')}
              value={o.media.series?.total ?? '—'}
              caption={
                o.media.series
                  ? t('{e} de {t} episódios', {
                      e: o.media.series.episodes,
                      t: o.media.series.episodesTotal,
                    })
                  : t('Sonarr indisponível')
              }
            />
            <StatCard
              to="/pedidos"
              icon={Inbox}
              color="var(--c-amber)"
              label={t('Pedidos')}
              value={o.counts.pendingRequests ?? '—'}
              caption={
                o.counts.pendingRequests === null
                  ? t('Seerr por ligar')
                  : t('à espera de aprovação')
              }
            />
            <StatCard
              to="/atividade"
              icon={Download}
              color="var(--c-emerald)"
              label={t('Downloads')}
              value={o.counts.downloading}
              caption={t('{q} em fila', { q: o.counts.queued })}
            />
          </>
        )}
      </div>

      {/* Filas de bilhetes */}
      <div className="mb-5 grid items-start gap-5 xl:grid-cols-2">
        <Section
          icon={CheckCircle2}
          color="var(--c-emerald)"
          title={t('Acabado de adicionar')}
          to="/biblioteca"
          linkLabel={t('Biblioteca')}
        >
          {!o ? (
            <Skeleton className="h-64" />
          ) : (
            <PosterRow items={o.recent} empty={t('Ainda não entrou nada novo na biblioteca.')} />
          )}
        </Section>
        <Section
          icon={Clock}
          color="var(--c-amber)"
          title={t('A caminho')}
          to="/atividade"
          linkLabel={t('Atividade')}
        >
          {!o ? (
            <Skeleton className="h-64" />
          ) : (
            <PosterRow items={o.upcoming} empty={t('Nada a descarregar nem em falta.')} />
          )}
        </Section>
      </div>

      {/* Próximos lançamentos */}
      <Section
        icon={Sparkles}
        color="var(--c-rose)"
        title={t('Próximos lançamentos')}
        to="/calendario"
        linkLabel={t('Calendário')}
      >
        {cal.isLoading ? (
          <Skeleton className="h-24" />
        ) : cal.data?.length ? (
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {cal.data.slice(0, 8).map((c, i) => (
              <li
                key={i}
                className="flex justify-between gap-3 rounded-xl p-2"
                style={{ background: 'var(--surface-2)' }}
              >
                <span className="truncate">
                  {c.title}
                  {c.subtitle && <span className="muted"> · {c.subtitle}</span>}
                </span>
                <time className="muted mono shrink-0" dateTime={c.date}>
                  {new Date(c.date).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted text-sm">{t('Nada agendado nas próximas semanas.')}</p>
        )}
      </Section>
    </>
  );
}
