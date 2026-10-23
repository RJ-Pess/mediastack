import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api, post } from '../api';
import { useLang, useT } from '../i18n';
import { Adopt } from './Adopt';
import { Backups } from './Backups';
import { Indexers } from './Indexers';
import { Button, Card, Dot, ErrorNote, PageHeader, Skeleton } from '../ui';

interface Desired {
  notifications: {
    type: 'none' | 'ntfy' | 'discord' | 'telegram';
    ntfyServerUrl: string;
    ntfyTopic: string;
    telegramChatId: string;
  };
  naming: { scheme: 'keep' | 'jellyfin' | 'plex' | 'emby' };
  backups: { intervalDays: number; retentionDays: number };
  quality: { profile: '1080p' | '4k' | 'both' | 'keep' };
  subtitles: { languages: string[] };
  storage: {
    tvRoot: string;
    moviesRoot: string;
    extraTvRoots: string[];
    extraMoviesRoots: string[];
  };
  downloads: {
    torrentsRoot: string;
    categories: { tv: string; movies: string };
    downKiBps: number;
    upKiBps: number;
    seedRatio: number;
  };
}
interface Change {
  fieldId: string;
  service: string;
  section: string;
  label: string;
  before: unknown;
  after: unknown;
}
interface Plan {
  changes: Change[];
  errors: { fieldId: string; service: string; error: string }[];
}
interface Audit {
  id: number;
  ts: string;
  fieldId: string;
  before: unknown;
  after: unknown;
  status: string;
  error: string | null;
}

const ICON: Record<string, string> = {
  sonarr: 'Sonarr',
  radarr: 'Radarr',
  bazarr: 'Bazarr',
  qbittorrent: 'qBittorrent',
  prowlarr: 'Prowlarr',
};
const show = (v: unknown) =>
  Array.isArray(v) ? v.join(', ') || '—' : v === '' || v === null ? '—' : String(v);
const QUALITIES: [Desired['quality']['profile'], string][] = [
  ['1080p', '1080p (Full HD)'],
  ['4k', '4K (Ultra HD)'],
  ['both', 'Ambos (1080p e 4K)'],
  ['keep', 'Manter os perfis atuais'],
];

const LANGS: [string, string][] = [
  ['pt', 'Português (PT)'],
  ['en', 'Inglês'],
  ['pb', 'Português (BR)'],
  ['es', 'Espanhol'],
  ['fr', 'Francês'],
];

function Section({
  title,
  affects,
  children,
}: {
  title: string;
  affects: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-semibold">{t(title)}</h2>
        <p className="muted text-xs">{t('Afeta: {services}', { services: affects })}</p>
      </div>
      {children}
    </Card>
  );
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm">{label}</span>
      {children}
    </label>
  );
}

export function Settings() {
  const t = useT();
  const { locale } = useLang();
  const fieldLabel = (c: { fieldId: string; label: string }) => {
    const k = `field:${c.fieldId}`;
    const r = t(k);
    return r === k ? c.label : r;
  };
  const qc = useQueryClient();
  const desired = useQuery({ queryKey: ['desired'], queryFn: () => api<Desired>('/api/desired') });
  const plan = useQuery({ queryKey: ['plan'], queryFn: () => api<Plan>('/api/plan') });
  const drift = useQuery({ queryKey: ['drift'], queryFn: () => api<Plan>('/api/drift') });
  const quality = useQuery({
    queryKey: ['quality'],
    queryFn: () => api<{ sync: { status: string; at: string | null } }>('/api/quality'),
    refetchInterval: 10_000,
  });
  const audit = useQuery({ queryKey: ['audit'], queryFn: () => api<Audit[]>('/api/audit') });
  const [draft, setDraft] = useState<Desired | null>(null);
  const value = draft ?? desired.data;

  const refresh = () =>
    Promise.all(
      ['desired', 'plan', 'drift', 'audit', 'quality'].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );
  const save = useMutation({
    mutationFn: (d: Desired) => api<Desired>('/api/desired', { method: 'PUT', body: d }),
    onSuccess: async () => {
      setDraft(null);
      await refresh();
    },
  });
  const apply = useMutation({
    mutationFn: (only?: string[]) =>
      post<{ failed: { fieldId: string; error: string }[] }>('/api/apply', only ? { only } : {}),
    onSuccess: refresh,
  });
  const adopt = useMutation({
    mutationFn: (fieldId: string) => post('/api/drift/adopt', { fieldId }),
    onSuccess: refresh,
  });

  const notif = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ hasSecret: boolean }>('/api/notifications'),
  });
  const [secret, setSecret] = useState('');
  const saveSecret = useMutation({
    mutationFn: () => api('/api/notifications/secret', { method: 'PUT', body: { value: secret } }),
    onSuccess: async () => {
      setSecret('');
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['notifications'] })]);
    },
  });
  const testNotif = useMutation({
    mutationFn: () => post<{ ok: boolean; message?: string }>('/api/notifications/test'),
  });

  if (!value)
    return (
      <>
        <PageHeader title={t('Definições')} />
        <ErrorNote error={desired.error} />
        <Skeleton className="h-60" />
      </>
    );
  const set = (f: (d: Desired) => void) => {
    const d = structuredClone(value);
    f(d);
    setDraft(d);
  };
  const num = (v: string) => Math.max(0, Number(v) || 0);
  const byService = new Map<string, Change[]>();
  for (const c of plan.data?.changes ?? [])
    byService.set(c.service, [...(byService.get(c.service) ?? []), c]);
  const grouped = [...byService];
  const driftChanges = drift.data?.changes ?? [];

  return (
    <>
      <PageHeader title={t('Definições')}>
        <div className="flex gap-2">
          {draft && (
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('Descartar')}
            </Button>
          )}
          <Button onClick={() => value && save.mutate(value)} disabled={!draft || save.isPending}>
            {t('Guardar')}
          </Button>
          <Button
            variant="primary"
            onClick={() => apply.mutate(undefined)}
            disabled={!!draft || !plan.data?.changes.length || apply.isPending}
          >
            {t('Aplicar tudo')}
            {plan.data?.changes.length ? ` (${plan.data.changes.length})` : ''}
          </Button>
        </div>
      </PageHeader>
      <ErrorNote error={save.error ?? apply.error ?? adopt.error} />
      {apply.data?.failed.length ? (
        <ErrorNote
          error={new Error(apply.data.failed.map((f) => `${f.fieldId}: ${f.error}`).join(' · '))}
        />
      ) : null}

      {driftChanges.length > 0 && (
        <Card className="mb-6 space-y-3" style={{ borderColor: 'var(--warn)' }}>
          <h2 className="font-semibold">
            <Dot state="warn" /> {t('Alterações feitas fora do MediaStack')}
          </h2>
          <ul className="space-y-2">
            {driftChanges.map((c) => (
              <li key={c.fieldId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex-1">
                  {ICON[c.service]} · {fieldLabel(c)}: <b>{show(c.before)}</b> ({t('esperado')}{' '}
                  <b>{show(c.after)}</b>)
                </span>
                <Button onClick={() => adopt.mutate(c.fieldId)}>{t('Adotar')}</Button>
                <Button onClick={() => apply.mutate([c.fieldId])}>{t('Repor')}</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Section title="Armazenamento" affects="Sonarr, Radarr, Bazarr, qBittorrent">
            <Row label={t('Biblioteca de séries')}>
              <input
                className="input"
                value={value.storage.tvRoot}
                onChange={(e) =>
                  set((d) => {
                    d.storage.tvRoot = e.target.value;
                  })
                }
              />
            </Row>
            <Row label={t('Biblioteca de filmes')}>
              <input
                className="input"
                value={value.storage.moviesRoot}
                onChange={(e) =>
                  set((d) => {
                    d.storage.moviesRoot = e.target.value;
                  })
                }
              />
            </Row>
            <Row label={t('Bibliotecas extra de filmes (uma por linha)')}>
              <textarea
                className="input"
                rows={2}
                value={value.storage.extraMoviesRoots.join('\n')}
                onChange={(e) =>
                  set((d) => {
                    d.storage.extraMoviesRoots = e.target.value
                      .split('\n')
                      .map((x) => x.trim())
                      .filter(Boolean);
                  })
                }
              />
            </Row>
            <Row label={t('Bibliotecas extra de séries (uma por linha)')}>
              <textarea
                className="input"
                rows={2}
                value={value.storage.extraTvRoots.join('\n')}
                onChange={(e) =>
                  set((d) => {
                    d.storage.extraTvRoots = e.target.value
                      .split('\n')
                      .map((x) => x.trim())
                      .filter(Boolean);
                  })
                }
              />
            </Row>
          </Section>
          <Section title="Downloads" affects="qBittorrent, Sonarr, Radarr">
            <Row label={t('Pasta de torrents')}>
              <input
                className="input"
                value={value.downloads.torrentsRoot}
                onChange={(e) =>
                  set((d) => {
                    d.downloads.torrentsRoot = e.target.value;
                  })
                }
              />
            </Row>
            <div className="grid grid-cols-2 gap-3">
              <Row label={t('Categoria (séries)')}>
                <input
                  className="input"
                  value={value.downloads.categories.tv}
                  onChange={(e) =>
                    set((d) => {
                      d.downloads.categories.tv = e.target.value;
                    })
                  }
                />
              </Row>
              <Row label={t('Categoria (filmes)')}>
                <input
                  className="input"
                  value={value.downloads.categories.movies}
                  onChange={(e) =>
                    set((d) => {
                      d.downloads.categories.movies = e.target.value;
                    })
                  }
                />
              </Row>
              <Row label={t('Limite de descarga (KiB/s)')}>
                <input
                  className="input"
                  inputMode="numeric"
                  value={value.downloads.downKiBps}
                  onChange={(e) =>
                    set((d) => {
                      d.downloads.downKiBps = num(e.target.value);
                    })
                  }
                />
              </Row>
              <Row label={t('Limite de envio (KiB/s)')}>
                <input
                  className="input"
                  inputMode="numeric"
                  value={value.downloads.upKiBps}
                  onChange={(e) =>
                    set((d) => {
                      d.downloads.upKiBps = num(e.target.value);
                    })
                  }
                />
              </Row>
              <Row label={t('Rácio de seeding (0 = desligado)')}>
                <input
                  className="input"
                  inputMode="decimal"
                  value={value.downloads.seedRatio}
                  onChange={(e) =>
                    set((d) => {
                      d.downloads.seedRatio = num(e.target.value);
                    })
                  }
                />
              </Row>
            </div>
            <p className="muted text-xs">{t('0 = sem limite.')}</p>
          </Section>
          <Section title="Qualidade" affects="Sonarr, Radarr, Seerr">
            <fieldset className="space-y-1">
              <legend className="sr-only">{t('Qualidade de vídeo')}</legend>
              {QUALITIES.map(([code, name]) => (
                <label key={code} className="flex min-h-10 items-center gap-3">
                  <input
                    type="radio"
                    name="quality"
                    className="size-5"
                    checked={value.quality.profile === code}
                    onChange={() =>
                      set((d) => {
                        d.quality.profile = code;
                      })
                    }
                  />
                  {t(name)}
                </label>
              ))}
            </fieldset>
            <p className="muted text-xs" role="status">
              {t('Perfis TRaSH (Recyclarr)')}:{' '}
              {t(
                {
                  ok: 'sincronizado',
                  error: 'falhou',
                  pending: 'a sincronizar…',
                  never: 'ainda não sincronizado',
                }[quality.data?.sync.status ?? 'never'] ?? 'ainda não sincronizado',
              )}
              {quality.data?.sync.at &&
                ` · ${new Date(quality.data.sync.at).toLocaleString(locale)}`}
            </p>
          </Section>
          <Section title="Nomes de ficheiros" affects="Sonarr, Radarr">
            <Row label={t('Esquema (TRaSH Guides)')}>
              <select
                className="input"
                value={value.naming.scheme}
                onChange={(e) =>
                  set((d) => {
                    d.naming.scheme = e.target.value as Desired['naming']['scheme'];
                  })
                }
              >
                <option value="keep">{t('Manter os atuais')}</option>
                <option value="jellyfin">Jellyfin</option>
                <option value="plex">Plex</option>
                <option value="emby">Emby</option>
              </select>
            </Row>
          </Section>
          <Section title="Agenda de backups" affects="Sonarr, Radarr, Prowlarr">
            <div className="grid grid-cols-2 gap-3">
              <Row label={t('Intervalo (dias)')}>
                <input
                  className="input"
                  inputMode="numeric"
                  value={value.backups.intervalDays}
                  onChange={(e) =>
                    set((d) => {
                      d.backups.intervalDays = Math.min(
                        30,
                        Math.max(1, Number(e.target.value) || 1),
                      );
                    })
                  }
                />
              </Row>
              <Row label={t('Retenção (dias)')}>
                <input
                  className="input"
                  inputMode="numeric"
                  value={value.backups.retentionDays}
                  onChange={(e) =>
                    set((d) => {
                      d.backups.retentionDays = Math.min(
                        365,
                        Math.max(1, Number(e.target.value) || 1),
                      );
                    })
                  }
                />
              </Row>
            </div>
          </Section>
          <Section title="Notificações" affects="Sonarr, Radarr, Prowlarr">
            <Row label={t('Destino')}>
              <select
                className="input"
                value={value.notifications.type}
                onChange={(e) =>
                  set((d) => {
                    d.notifications.type = e.target.value as Desired['notifications']['type'];
                  })
                }
              >
                <option value="none">{t('Desligadas')}</option>
                <option value="ntfy">ntfy</option>
                <option value="discord">Discord</option>
                <option value="telegram">Telegram</option>
              </select>
            </Row>
            {value.notifications.type === 'ntfy' && (
              <div className="grid grid-cols-2 gap-3">
                <Row label={t('Servidor ntfy')}>
                  <input
                    className="input"
                    value={value.notifications.ntfyServerUrl}
                    onChange={(e) =>
                      set((d) => {
                        d.notifications.ntfyServerUrl = e.target.value;
                      })
                    }
                  />
                </Row>
                <Row label={t('Tópico')}>
                  <input
                    className="input"
                    value={value.notifications.ntfyTopic}
                    onChange={(e) =>
                      set((d) => {
                        d.notifications.ntfyTopic = e.target.value;
                      })
                    }
                  />
                </Row>
              </div>
            )}
            {value.notifications.type === 'telegram' && (
              <Row label={t('ID do chat')}>
                <input
                  className="input"
                  value={value.notifications.telegramChatId}
                  onChange={(e) =>
                    set((d) => {
                      d.notifications.telegramChatId = e.target.value;
                    })
                  }
                />
              </Row>
            )}
            {value.notifications.type !== 'none' && (
              <div className="space-y-2">
                <Row
                  label={
                    value.notifications.type === 'discord'
                      ? t('URL do webhook')
                      : value.notifications.type === 'telegram'
                        ? t('Token do bot')
                        : t('Token de acesso (opcional)')
                  }
                >
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    value={secret}
                    placeholder={notif.data?.hasSecret ? t('Guardado (cifrado)') : ''}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                </Row>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => saveSecret.mutate()}
                    disabled={!secret.trim() || saveSecret.isPending}
                  >
                    {t('Guardar segredo')}
                  </Button>
                  <Button onClick={() => testNotif.mutate()} disabled={testNotif.isPending}>
                    {t('Enviar teste')}
                  </Button>
                </div>
                <ErrorNote error={saveSecret.error} />
                {testNotif.data && (
                  <p
                    role="status"
                    className="text-sm"
                    style={{ color: testNotif.data.ok ? 'var(--ok)' : 'var(--bad)' }}
                  >
                    {testNotif.data.ok
                      ? t('Teste enviado')
                      : (testNotif.data.message ?? t('Falhou'))}
                  </p>
                )}
              </div>
            )}
          </Section>
          <Section title="Legendas" affects="Bazarr">
            <fieldset className="space-y-1">
              <legend className="sr-only">{t('Idiomas das legendas')}</legend>
              {LANGS.map(([c, n]) => (
                <label key={c} className="flex min-h-10 items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={value.subtitles.languages.includes(c)}
                    onChange={() =>
                      set((d) => {
                        d.subtitles.languages = d.subtitles.languages.includes(c)
                          ? d.subtitles.languages.filter((x) => x !== c)
                          : [...d.subtitles.languages, c];
                      })
                    }
                  />
                  {t(n)}
                </label>
              ))}
            </fieldset>
          </Section>
        </div>

        <div className="space-y-6">
          <Card className="space-y-3">
            <h2 className="font-semibold">{t('Plano de alterações')}</h2>
            {draft && (
              <p className="muted text-sm">
                {t('Guarda primeiro para ver o que muda nos serviços.')}
              </p>
            )}
            {plan.isLoading ? (
              <Skeleton className="h-24" />
            ) : grouped.length ? (
              grouped.map(([svc, changes]) => (
                <div key={svc}>
                  <p className="mb-1 text-sm font-medium">{ICON[svc] ?? svc}</p>
                  <ul className="space-y-1">
                    {changes?.map((c) => (
                      <li
                        key={c.fieldId}
                        className="rounded-lg p-2 text-sm"
                        style={{ background: 'var(--surface-2)' }}
                      >
                        <p className="muted text-xs">{fieldLabel(c)}</p>
                        <p className="flex flex-wrap items-center gap-2">
                          <del className="muted">{show(c.before)}</del>
                          <ArrowRight className="size-4" aria-label={t('passa a')} />
                          <b>{show(c.after)}</b>
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <p className="muted text-sm">
                <Dot state="ok" /> {t('Tudo em sincronia com o estado desejado.')}
              </p>
            )}
            {plan.data?.errors.map((e) => (
              <p key={e.fieldId} className="text-sm" style={{ color: 'var(--bad)' }}>
                {e.fieldId}: {e.error}
              </p>
            ))}
          </Card>
          <Indexers />
          <Backups />
          <Adopt />
          <Card>
            <h2 className="mb-3 font-semibold">{t('Histórico')}</h2>
            <ul className="max-h-72 space-y-1 overflow-auto text-xs">
              {audit.data?.length ? (
                audit.data.map((a) => (
                  <li key={a.id}>
                    <time className="muted" dateTime={a.ts}>
                      {new Date(a.ts).toLocaleString(locale)}
                    </time>{' '}
                    · {a.fieldId}: {show(a.before)} → {show(a.after)}{' '}
                    {a.status === 'error' && <b style={{ color: 'var(--bad)' }}>({a.error})</b>}
                  </li>
                ))
              ) : (
                <li className="muted">{t('Sem registos.')}</li>
              )}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
