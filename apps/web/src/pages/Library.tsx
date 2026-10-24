import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bookmark,
  BookmarkX,
  Check,
  CheckCircle2,
  CircleDashed,
  EyeOff,
  Search,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, fmtBytes, post } from '../api';
import { useT } from '../i18n';
import { Button, Empty, ErrorNote, PageHeader, Poster, Skeleton, Ticket, cx } from '../ui';

interface Item {
  id: number;
  kind: 'movie' | 'series';
  title: string;
  year: number;
  poster: string | null;
  hasFile: boolean;
  sizeOnDisk: number;
  status: string;
  monitored: boolean;
}
const keyOf = (i: Item) => `${i.kind}:${i.id}`;

export function Library() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['library'], queryFn: () => api<Item[]>('/api/library') });
  const [kind, setKind] = useState<'all' | 'movie' | 'series'>('all');
  const [state, setState] = useState<'all' | 'available' | 'missing' | 'unmonitored'>('all');
  const [text, setText] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Item | null>(null);

  const items = useMemo(
    () =>
      (q.data ?? []).filter(
        (i) =>
          (kind === 'all' || i.kind === kind) &&
          i.title.toLowerCase().includes(text.toLowerCase()) &&
          (state === 'all' ||
            (state === 'available' && i.hasFile) ||
            (state === 'missing' && !i.hasFile && i.monitored) ||
            (state === 'unmonitored' && !i.monitored)),
      ),
    [q.data, kind, text, state],
  );

  const act = useMutation({
    mutationFn: (action: 'search' | 'monitor' | 'unmonitor') =>
      post('/api/library/bulk', {
        action,
        items: (q.data ?? [])
          .filter((i) => selected.has(keyOf(i)))
          .map((i) => ({ kind: i.kind, id: i.id })),
      }),
    onSuccess: async (_d, action) => {
      if (action !== 'search') await qc.invalidateQueries({ queryKey: ['library'] });
      setSelected(new Set());
      setSelecting(false);
    },
  });

  const toggle = (i: Item) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(keyOf(i))) n.delete(keyOf(i));
      else n.add(keyOf(i));
      return n;
    });
  const badge = (i: Item) =>
    !i.monitored
      ? { icon: <EyeOff className="size-3" aria-hidden />, label: t('Não monitorizado') }
      : i.hasFile
        ? { icon: <CheckCircle2 className="size-3" aria-hidden />, label: t('Disponível') }
        : { icon: <CircleDashed className="size-3" aria-hidden />, label: t('Em falta') };

  return (
    <>
      <PageHeader title={t('Biblioteca')} />
      <div className="panel mb-5 flex flex-wrap items-center gap-2 !p-3">
        <label className="sr-only" htmlFor="lib-filter">
          {t('Filtrar por título')}
        </label>
        <input
          id="lib-filter"
          className="input !w-56"
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
        <select
          className="input !w-auto"
          aria-label={t('Estado')}
          value={state}
          onChange={(e) => setState(e.target.value as typeof state)}
        >
          <option value="all">{t('Todos os estados')}</option>
          <option value="available">{t('Disponível')}</option>
          <option value="missing">{t('Em falta')}</option>
          <option value="unmonitored">{t('Não monitorizado')}</option>
        </select>
        <span className="muted text-sm">{t('{n} títulos', { n: items.length })}</span>
        <Button
          className="ml-auto"
          variant={selecting ? 'primary' : 'default'}
          aria-pressed={selecting}
          onClick={() => {
            setSelecting((s) => !s);
            setSelected(new Set());
          }}
        >
          <Check className="size-4" aria-hidden /> {t('Selecionar')}
        </Button>
      </div>

      {selecting && (
        <div
          className="panel sticky top-20 z-10 mb-5 flex flex-wrap items-center gap-2 !p-3"
          role="toolbar"
          aria-label={t('Ações em lote')}
        >
          <span className="text-sm font-semibold">
            {t('{n} selecionados', { n: selected.size })}
          </span>
          <Button variant="ghost" onClick={() => setSelected(new Set(items.map(keyOf)))}>
            {t('Selecionar todos')}
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button disabled={!selected.size || act.isPending} onClick={() => act.mutate('search')}>
              <Search className="size-4" aria-hidden /> {t('Procurar agora')}
            </Button>
            <Button
              disabled={!selected.size || act.isPending}
              onClick={() => act.mutate('monitor')}
            >
              <Bookmark className="size-4" aria-hidden /> {t('Monitorizar')}
            </Button>
            <Button
              disabled={!selected.size || act.isPending}
              onClick={() => act.mutate('unmonitor')}
            >
              <BookmarkX className="size-4" aria-hidden /> {t('Deixar de monitorizar')}
            </Button>
          </div>
        </div>
      )}

      <ErrorNote error={q.error ?? act.error} />
      {q.isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="aspect-[2/3]" />
          ))}
        </div>
      ) : items.length ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((i) => {
            const isSel = selected.has(keyOf(i));
            return (
              <li
                key={keyOf(i)}
                className={cx('rounded-[0.9rem]', isSel && 'outline outline-3 outline-offset-2')}
                style={isSel ? { outlineColor: 'var(--accent)' } : undefined}
              >
                <Ticket
                  title={i.title}
                  poster={i.poster}
                  kicker={`${i.kind === 'movie' ? t('Filme') : t('Série')} · ${i.year}`}
                  badge={badge(i)}
                  onClick={() => (selecting ? toggle(i) : setOpen(i))}
                />
              </li>
            );
          })}
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
            className="panel grid w-full max-w-lg grid-cols-[8rem_1fr] gap-4"
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
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  onClick={async () => {
                    await post('/api/library/bulk', {
                      action: 'search',
                      items: [{ kind: open.kind, id: open.id }],
                    });
                    setOpen(null);
                  }}
                >
                  <Search className="size-4" aria-hidden /> {t('Procurar agora')}
                </Button>
                <Button variant="ghost" onClick={() => setOpen(null)}>
                  <X className="size-4" aria-hidden /> {t('Fechar')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
