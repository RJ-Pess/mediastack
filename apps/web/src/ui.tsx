import type { ComponentProps, ReactNode } from 'react';
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

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
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
