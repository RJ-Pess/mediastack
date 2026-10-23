import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { api, post } from '../api';
import { useT } from '../i18n';
import { Button, Card, Dot, ErrorNote } from '../ui';

const SERVICES = [
  ['sonarr', 'Sonarr', 'http://192.168.1.10:8989'],
  ['radarr', 'Radarr', 'http://192.168.1.10:7878'],
  ['prowlarr', 'Prowlarr', 'http://192.168.1.10:9696'],
  ['bazarr', 'Bazarr', 'http://192.168.1.10:6767'],
  ['qbittorrent', 'qBittorrent', 'http://192.168.1.10:8080'],
  ['seerr', 'Seerr', 'http://192.168.1.10:5055'],
] as const;

type Form = Record<string, { url: string; key: string; username: string }>;
interface TestResult {
  service: string;
  ok: boolean;
  version?: string;
  error?: string;
}
interface Preview {
  notes: string[];
  changes: { path: string; from: unknown; to: unknown }[];
}

const show = (v: unknown) =>
  Array.isArray(v) ? v.join(', ') || '—' : v === '' || v == null ? '—' : String(v);

/** Modo importar: liga a serviços já existentes e converte a configuração em estado desejado. */
export function Adopt() {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>({});
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [accepted, setAccepted] = useState(false);

  const state = useQuery({
    queryKey: ['adopt'],
    queryFn: () =>
      api<{ external: boolean; connections: Record<string, { url: string }> }>('/api/adopt'),
  });

  const body = () => ({
    services: Object.fromEntries(
      Object.entries(form)
        .filter(([, v]) => v.url.trim() && v.key.trim())
        .map(([k, v]) => [
          k,
          {
            url: v.url.trim(),
            key: v.key,
            ...(k === 'qbittorrent' ? { username: v.username || 'admin' } : {}),
          },
        ]),
    ),
  });
  const set = (svc: string, field: 'url' | 'key' | 'username', value: string) =>
    setForm((f) => ({
      ...f,
      [svc]: { url: '', key: '', username: '', ...f[svc], [field]: value },
    }));

  const test = useMutation({
    mutationFn: () => post<TestResult[]>('/api/adopt/test', body()),
    onSuccess: setResults,
  });
  const connect = useMutation({
    mutationFn: () => post('/api/adopt/connect', body()),
    onSuccess: async () => {
      setForm({});
      setResults(null);
      await qc.invalidateQueries({ queryKey: ['adopt'] });
    },
  });
  const loadPreview = useMutation({
    mutationFn: () => api<Preview>('/api/adopt/preview'),
    onSuccess: (p) => {
      setPreview(p);
      setAccepted(false);
    },
  });
  const accept = useMutation({
    mutationFn: () => post('/api/adopt/accept'),
    onSuccess: async () => {
      setAccepted(true);
      await Promise.all(
        ['desired', 'plan', 'drift', 'quality'].map((k) => qc.invalidateQueries({ queryKey: [k] })),
      );
    },
  });
  const disconnect = useMutation({
    mutationFn: () => api('/api/adopt', { method: 'DELETE' }),
    onSuccess: async () => {
      setPreview(null);
      await qc.invalidateQueries({ queryKey: ['adopt'] });
    },
  });

  const external = state.data?.external ?? false;
  const anyFilled = Object.values(form).some((v) => v.url.trim() && v.key.trim());

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-semibold">{t('Importar uma instalação existente')}</h2>
        <p className="muted text-xs">
          {t('Nada é alterado nos serviços até aplicares as definições.')}
        </p>
      </div>
      <ErrorNote
        error={
          state.error ??
          test.error ??
          connect.error ??
          loadPreview.error ??
          accept.error ??
          disconnect.error
        }
      />

      {external ? (
        <div className="space-y-2">
          <p className="text-sm">
            <Dot state="warn" /> {t('Modo importar ativo: o MediaStack usa estes serviços.')}
          </p>
          <ul className="muted space-y-1 text-xs">
            {Object.entries(state.data?.connections ?? {}).map(([k, c]) => (
              <li key={k}>
                <b className="capitalize">{k}</b> · {c.url}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => loadPreview.mutate()} disabled={loadPreview.isPending}>
              {t('Rever o que será importado')}
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                window.confirm(t('Voltar a usar os serviços do stack do MediaStack?')) &&
                disconnect.mutate()
              }
            >
              {t('Desligar')}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            connect.mutate();
          }}
        >
          {SERVICES.map(([id, name, placeholder]) => (
            <fieldset key={id} className="space-y-1">
              <legend className="text-sm font-medium">{name}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  className="input"
                  aria-label={`${name} URL`}
                  placeholder={placeholder}
                  value={form[id]?.url ?? ''}
                  onChange={(e) => set(id, 'url', e.target.value)}
                />
                <div className="flex gap-2">
                  {id === 'qbittorrent' && (
                    <input
                      className="input"
                      aria-label={t('Utilizador')}
                      placeholder={t('Utilizador')}
                      value={form[id]?.username ?? ''}
                      onChange={(e) => set(id, 'username', e.target.value)}
                    />
                  )}
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    aria-label={id === 'qbittorrent' ? t('Palavra-passe') : `${name} API key`}
                    placeholder={id === 'qbittorrent' ? t('Palavra-passe') : 'API key'}
                    value={form[id]?.key ?? ''}
                    onChange={(e) => set(id, 'key', e.target.value)}
                  />
                </div>
              </div>
            </fieldset>
          ))}
          {results && (
            <ul className="space-y-1 text-sm" aria-live="polite">
              {results.map((r) => (
                <li key={r.service} className="flex items-center gap-2">
                  <Dot state={r.ok ? 'ok' : 'bad'} />
                  <span className="capitalize">{r.service}</span>
                  <span className="muted text-xs">{r.ok ? (r.version ?? 'OK') : r.error}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => test.mutate()}
              disabled={!anyFilled || test.isPending}
            >
              {t('Testar ligações')}
            </Button>
            <Button variant="primary" type="submit" disabled={!anyFilled || connect.isPending}>
              {t('Ligar')}
            </Button>
          </div>
        </form>
      )}

      {preview && (
        <div className="space-y-3">
          <ul className="muted list-disc space-y-1 pl-5 text-xs">
            {preview.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          {preview.changes.length ? (
            <ul className="space-y-1">
              {preview.changes.map((c) => (
                <li
                  key={c.path}
                  className="rounded-lg p-2 text-sm"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <p className="muted text-xs">{c.path}</p>
                  <p className="flex flex-wrap items-center gap-2">
                    <del className="muted">{show(c.from)}</del>
                    <ArrowRight className="size-4" aria-label={t('passa a')} />
                    <b>{show(c.to)}</b>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted text-sm">{t('O estado desejado já coincide com a instalação.')}</p>
          )}
          <Button
            variant="primary"
            onClick={() => accept.mutate()}
            disabled={accept.isPending || accepted}
          >
            {accepted ? t('Importado: revê o plano acima') : t('Aceitar como estado desejado')}
          </Button>
        </div>
      )}
    </Card>
  );
}
