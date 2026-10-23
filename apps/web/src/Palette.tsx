import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, post } from './api';
import { useT } from './i18n';
import { ErrorNote, Poster } from './ui';

export interface SearchResult {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: string;
  poster: string | null;
  mediaStatus: number;
}

/** Pesquisa global (⌘K): procura no TMDB (via Seerr) e pede com um clique. */
export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
    else setQ('');
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api<SearchResult[]>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length > 1,
  });
  const request = useMutation({
    mutationFn: (r: SearchResult) =>
      post('/api/request', { mediaType: r.mediaType, tmdbId: r.tmdbId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['search'] });
      void qc.invalidateQueries({ queryKey: ['requests'] });
    },
  });

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-start bg-black/60 p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Pesquisa global')}
        className="card mx-auto w-full max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <label htmlFor="global-search" className="sr-only">
          {t('Pesquisar filmes e séries')}
        </label>
        <input
          id="global-search"
          ref={input}
          className="input"
          placeholder={t('Pesquisar filmes e séries…')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ErrorNote error={results.error ?? request.error} />
        <ul className="mt-3 max-h-[60vh] space-y-2 overflow-auto">
          {results.isFetching && (
            <li className="muted p-2">
              <Loader2 className="inline size-4 animate-spin" aria-hidden /> {t('A procurar…')}
            </li>
          )}
          {results.data?.map((r) => (
            <li
              key={`${r.mediaType}${r.tmdbId}`}
              className="flex items-center gap-3 rounded-lg p-2"
              style={{ background: 'var(--surface-2)' }}
            >
              <div className="w-12 shrink-0">
                <Poster src={r.poster} title={r.title} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.title}</p>
                <p className="muted text-sm">
                  {r.mediaType === 'movie' ? t('Filme') : t('Série')} · {r.year || '—'}
                </p>
              </div>
              {r.mediaStatus >= 2 ? (
                <span className="muted flex items-center gap-1 text-sm">
                  <Check className="size-4" aria-hidden />{' '}
                  {r.mediaStatus === 5 ? t('Disponível') : t('Pedido')}
                </span>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => request.mutate(r)}
                  disabled={request.isPending}
                >
                  <Plus className="size-4" aria-hidden /> {t('Pedir')}
                </button>
              )}
            </li>
          ))}
          {results.data?.length === 0 && <li className="muted p-2">{t('Sem resultados.')}</li>}
        </ul>
      </div>
    </div>
  );
}
