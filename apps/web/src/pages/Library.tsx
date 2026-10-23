import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, fmtBytes } from '../api';
import { useT } from '../i18n';
import { Empty, ErrorNote, PageHeader, Poster, Skeleton } from '../ui';

interface Item {
  id: number;
  kind: 'movie' | 'series';
  title: string;
  year: number;
  poster: string | null;
  hasFile: boolean;
  sizeOnDisk: number;
  status: string;
}

export function Library() {
  const t = useT();
  const q = useQuery({ queryKey: ['library'], queryFn: () => api<Item[]>('/api/library') });
  const [kind, setKind] = useState<'all' | 'movie' | 'series'>('all');
  const [text, setText] = useState('');
  const [onlyMissing, setMissing] = useState(false);
  const [open, setOpen] = useState<Item | null>(null);

  const items = useMemo(
    () =>
      (q.data ?? []).filter(
        (i) =>
          (kind === 'all' || i.kind === kind) &&
          i.title.toLowerCase().includes(text.toLowerCase()) &&
          (!onlyMissing || !i.hasFile),
      ),
    [q.data, kind, text, onlyMissing],
  );

  return (
    <>
      <PageHeader title={t('Biblioteca')}>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="lib-filter">
            {t('Filtrar por título')}
          </label>
          <input
            id="lib-filter"
            className="input !w-48"
            placeholder={t('Filtrar…')}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <select
            className="input !w-auto"
            aria-label={t('Tipo')}
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="all">{t('Tudo')}</option>
            <option value="movie">{t('Filmes')}</option>
            <option value="series">{t('Séries')}</option>
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={onlyMissing}
              onChange={(e) => setMissing(e.target.checked)}
            />{' '}
            {t('Só em falta')}
          </label>
        </div>
      </PageHeader>
      <ErrorNote error={q.error} />
      {q.isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="aspect-[2/3]" />
          ))}
        </div>
      ) : items.length ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((i) => (
            <li key={`${i.kind}${i.id}`}>
              <button className="poster-card block w-full text-left" onClick={() => setOpen(i)}>
                <div className="relative">
                  <Poster src={i.poster} title={i.title} />
                  {!i.hasFile && (
                    <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-amber-300">
                      {t('Em falta')}
                    </span>
                  )}
                </div>
                <p className="mt-2 truncate text-sm font-medium">{i.title}</p>
                <p className="muted text-xs">
                  {i.year} · {i.kind === 'movie' ? t('Filme') : t('Série')}
                </p>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t('Nada para mostrar. Pede algo com ⌘K.')}</Empty>
      )}

      {open && (
        <div
          className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4"
          onClick={() => setOpen(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={open.title}
            className="card grid w-full max-w-lg grid-cols-[8rem_1fr] gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <Poster src={open.poster} title={open.title} />
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">
                {open.title} <span className="muted font-normal">({open.year})</span>
              </h2>
              <p className="muted text-sm">
                {open.kind === 'movie' ? t('Filme') : t('Série')} · {open.status}
              </p>
              <p className="text-sm">
                {open.hasFile
                  ? t('No disco: {size}', { size: fmtBytes(open.sizeOnDisk) })
                  : t('Ainda sem ficheiros.')}
              </p>
              <button className="btn" onClick={() => setOpen(null)}>
                {t('Fechar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
