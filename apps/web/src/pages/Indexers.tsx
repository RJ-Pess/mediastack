import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, post } from '../api';
import { useT } from '../i18n';
import { Button, Card, ErrorNote, Skeleton } from '../ui';

interface Installed {
  id: number;
  name: string;
  enable: boolean;
  privacy: string;
}
interface Available {
  definitionName: string;
  name: string;
  language: string;
  description: string;
}
interface TestResult {
  ok: boolean;
  message?: string;
}

/** Indexadores do Prowlarr: ativar/desativar, testar, remover e adicionar públicos. */
export function Indexers() {
  const t = useT();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [results, setResults] = useState<Record<number, TestResult>>({});
  const q = useQuery({
    queryKey: ['indexers'],
    queryFn: () => api<{ installed: Installed[]; available: Available[] }>('/api/indexers'),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['indexers'] });
  const add = useMutation({
    mutationFn: (definitionName: string) => post('/api/indexers', { definitionName }),
    onSuccess: refresh,
  });
  const toggle = useMutation({
    mutationFn: (v: { id: number; enable: boolean }) =>
      post(`/api/indexers/${v.id}/enabled`, { enable: v.enable }),
    onSuccess: refresh,
  });
  const test = useMutation({
    mutationFn: async (id: number) => ({
      id,
      r: await post<TestResult>(`/api/indexers/${id}/test`),
    }),
    onSuccess: ({ id, r }) => setResults((prev) => ({ ...prev, [id]: r })),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/api/indexers/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const matches =
    text.trim().length >= 2
      ? (q.data?.available ?? [])
          .filter((a) =>
            `${a.name} ${a.description}`.toLowerCase().includes(text.trim().toLowerCase()),
          )
          .slice(0, 12)
      : [];

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-semibold">{t('Indexadores')}</h2>
        <p className="muted text-xs">
          {t('Afeta: {services}', { services: 'Prowlarr → Sonarr, Radarr' })}
        </p>
      </div>
      <ErrorNote error={q.error ?? add.error ?? toggle.error ?? test.error ?? remove.error} />
      {q.isLoading ? (
        <Skeleton className="h-24" />
      ) : (
        <>
          {q.data?.installed.length ? (
            <ul className="space-y-2">
              {q.data.installed.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg p-2"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <label className="flex min-h-10 flex-1 items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={i.enable}
                      onChange={(e) => toggle.mutate({ id: i.id, enable: e.target.checked })}
                    />
                    <span className="truncate">{i.name}</span>
                    <span className="muted text-xs">{i.privacy}</span>
                  </label>
                  <Button onClick={() => test.mutate(i.id)} disabled={test.isPending}>
                    {t('Testar')}
                  </Button>
                  <Button
                    variant="danger"
                    aria-label={t('Remover {title}', { title: i.name })}
                    onClick={() =>
                      window.confirm(t('Remover o indexador "{title}"?', { title: i.name })) &&
                      remove.mutate(i.id)
                    }
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                  {results[i.id] && (
                    <p
                      className="w-full text-sm"
                      role="status"
                      style={{ color: results[i.id]!.ok ? 'var(--ok)' : 'var(--bad)' }}
                    >
                      {results[i.id]!.ok
                        ? t('Ligação OK')
                        : (results[i.id]!.message ?? t('Falhou'))}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted text-sm">{t('Ainda não há indexadores.')}</p>
          )}

          <div>
            <label className="text-sm font-medium" htmlFor="indexer-search">
              {t('Adicionar indexador público')}
            </label>
            <input
              id="indexer-search"
              className="input mt-1"
              placeholder={t('Pesquisar (mín. 2 letras)…')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <ul className="mt-2 space-y-1">
              {matches.map((m) => (
                <li key={m.definitionName} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">
                    {m.name} <span className="muted text-xs">{m.language}</span>
                  </span>
                  <Button onClick={() => add.mutate(m.definitionName)} disabled={add.isPending}>
                    <Plus className="size-4" aria-hidden /> {t('Adicionar')}
                  </Button>
                </li>
              ))}
            </ul>
            <p className="muted mt-2 text-xs">
              {t(
                'Os indexadores privados precisam de credenciais: configura-os na UI do Prowlarr.',
              )}
            </p>
          </div>
        </>
      )}
    </Card>
  );
}
