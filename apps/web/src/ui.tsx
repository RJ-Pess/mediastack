import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { useT } from './i18n';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({ className, ...p }: ComponentProps<'div'>) {
  return <div className={cx('card', className)} {...p} />;
}

export function Button({
  variant = 'default',
  className,
  ...p
}: ComponentProps<'button'> & { variant?: 'default' | 'primary' | 'ghost' | 'danger' }) {
  return <button className={cx('btn', `btn-${variant}`, className)} {...p} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />;
}

export function Dot({ state }: { state: 'ok' | 'warn' | 'bad' | 'idle' }) {
  const t = useT();
  const label = t({ ok: 'Em ordem', warn: 'Atenção', bad: 'Problema', idle: 'Inativo' }[state]);
  return <span className={cx('dot', `dot-${state}`)} role="img" aria-label={label} />;
}

/**
 * Título da página. No desktop o título visível está na barra de topo, por isso aqui o <h1>
 * fica só para leitores de ecrã (e visível no telemóvel, onde a barra de topo não o mostra).
 */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      className={cx(
        'mb-5 flex flex-wrap items-center justify-between gap-3 md:justify-end',
        !children && 'md:mb-0',
      )}
    >
      <h1 className="text-2xl font-bold tracking-tight md:sr-only">{title}</h1>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted py-10 text-center">{children}</p>;
}

export function ErrorNote({ error }: { error: unknown }) {
  const t = useT();
  if (!error) return null;
  return (
    <p role="alert" className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
      {t(error instanceof Error ? error.message : String(error))}
    </p>
  );
}

export function Poster({ src, title }: { src: string | null; title: string }) {
  const t = useT();
  return src ? (
    <img
      src={src}
      alt={t('Poster de {title}', { title })}
      loading="lazy"
      className="aspect-[2/3] w-full rounded-lg object-cover"
    />
  ) : (
    <div
      className="poster-fallback aspect-[2/3] w-full rounded-lg"
      role="img"
      aria-label={t('Sem poster para {title}', { title })}
    >
      {title.slice(0, 1)}
    </div>
  );
}

/** Ícone num quadrado colorido. `color` é uma variável CSS, ex.: `var(--c-sky)`. */
export function IconTile({
  icon: Icon,
  color,
  large,
}: {
  icon: (p: { className?: string; 'aria-hidden'?: boolean }) => ReactNode;
  color: string;
  large?: boolean;
}) {
  return (
    <span className={cx('tile', large && 'tile-lg')} style={{ '--tile': color } as CSSProperties}>
      <Icon className={large ? 'size-5' : 'size-4'} aria-hidden />
    </span>
  );
}

export function Meter({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: 'ok' | 'warn';
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className={cx('bar', tone === 'ok' && 'bar-ok', tone === 'warn' && 'bar-warn')}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export interface TicketProps {
  title: string;
  poster: string | null;
  kicker: string;
  badge?: { label: string; icon?: ReactNode };
  /** Canto superior direito (ex.: nota). */
  corner?: ReactNode;
  progress?: number;
  href?: string;
  onClick?: () => void;
  footer?: ReactNode;
}

/** Poster em forma de bilhete, com canhoto picotado (tipo · ano) e um estado opcional. */
export function Ticket({
  title,
  poster,
  kicker,
  badge,
  corner,
  progress,
  href,
  onClick,
  footer,
}: TicketProps) {
  const t = useT();
  const body = (
    <>
      <div className="ticket-art">
        {poster ? (
          <img src={poster} alt="" loading="lazy" />
        ) : (
          <div className="poster-fallback size-full" aria-hidden>
            {title.slice(0, 1)}
          </div>
        )}
        {badge && (
          <span className="ticket-badge">
            {badge.icon}
            {badge.label}
          </span>
        )}
        {corner && <span className="ticket-badge !left-auto right-2">{corner}</span>}
        {progress !== undefined && (
          <div
            className="ticket-progress"
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('Progresso de {title}', { title })}
          >
            <span style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>
      <div className="ticket-stub">
        <p className="ticket-kicker">{kicker}</p>
        <p className="ticket-title">{title}</p>
        {footer && <div className="mt-auto">{footer}</div>}
      </div>
    </>
  );
  if (href) {
    return (
      <a className="ticket" href={href}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" className="ticket text-left" onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className="ticket">{body}</div>;
}
