import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Anchor, Check, CircleAlert, Loader2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api, post } from '../api';
import { Button, Card, ErrorNote } from '../ui';

function Frame({ title, children, step }: { title: string; children: ReactNode; step?: string }) {
  return (
    <main className="mx-auto grid min-h-screen max-w-lg content-center gap-4 px-4 py-10">
      <div className="flex items-center gap-2">
        <Anchor className="size-7" style={{ color: 'var(--accent)' }} aria-hidden />
        <span className="text-xl font-semibold">Cais</span>
        {step && <span className="muted ml-auto text-sm">{step}</span>}
      </div>
      <Card className="space-y-4">
        <h1 className="text-xl font-semibold">{title}</h1>
        {children}
      </Card>
    </main>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="muted block text-xs">{hint}</span>}
    </label>
  );
}

export function Login() {
  const qc = useQueryClient();
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const login = useMutation({
    mutationFn: () => post('/api/auth/login', { username, password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  return (
    <Frame title="Entrar">
      <form className="space-y-4" onSubmit={(e: FormEvent) => (e.preventDefault(), login.mutate())}>
        <ErrorNote error={login.error} />
        <Field label="Utilizador">
          <input
            className="input"
            autoComplete="username"
            value={username}
            onChange={(e) => setU(e.target.value)}
          />
        </Field>
        <Field label="Palavra-passe">
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setP(e.target.value)}
          />
        </Field>
        <Button variant="primary" type="submit" disabled={login.isPending}>
          Entrar
        </Button>
      </form>
    </Frame>
  );
}

interface Desired {
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
interface HardlinkRow {
  from: string;
  to: string;
  ok: boolean;
  message?: string;
}
interface Plan {
  changes: { fieldId: string; service: string; label: string }[];
  errors: { fieldId: string; error: string }[];
}

const LANGS: [string, string][] = [
  ['pt', 'Português (PT)'],
  ['en', 'Inglês'],
  ['pb', 'Português (BR)'],
  ['es', 'Espanhol'],
  ['fr', 'Francês'],
];
type Step = 'admin' | 'storage' | 'subs' | 'jellyfin' | 'apply';
const ORDER: Step[] = ['admin', 'storage', 'subs', 'jellyfin', 'apply'];

export function Wizard({ startAt }: { startAt: Step }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(startAt);
  const next = () => setStep(ORDER[ORDER.indexOf(step) + 1] ?? 'apply');
  const label = `Passo ${ORDER.indexOf(step) + 1} de ${ORDER.length}`;

  if (step === 'admin')
    return (
      <AdminStep
        label={label}
        onDone={async () => {
          await qc.invalidateQueries({ queryKey: ['me'] });
          next();
        }}
      />
    );
  if (step === 'storage') return <StorageStep label={label} onDone={next} />;
  if (step === 'subs') return <SubsStep label={label} onDone={next} />;
  if (step === 'jellyfin') return <JellyfinStep label={label} onDone={next} />;
  return <ApplyStep label={label} onDone={() => qc.invalidateQueries({ queryKey: ['me'] })} />;
}

function AdminStep({ label, onDone }: { label: string; onDone: () => void }) {
  const [username, setU] = useState('admin');
  const [password, setP] = useState('');
  const m = useMutation({
    mutationFn: () => post('/api/auth/setup', { username, password }),
    onSuccess: onDone,
  });
  return (
    <Frame title="Bem-vindo! Cria o administrador" step={label}>
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
        <ErrorNote error={m.error} />
        <Field label="Utilizador">
          <input
            className="input"
            autoComplete="username"
            value={username}
            onChange={(e) => setU(e.target.value)}
          />
        </Field>
        <Field label="Palavra-passe" hint="Mínimo de 10 caracteres.">
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setP(e.target.value)}
          />
        </Field>
        <Button variant="primary" type="submit" disabled={m.isPending}>
          Continuar
        </Button>
      </form>
    </Frame>
  );
}

function useDesired() {
  const q = useQuery({ queryKey: ['desired'], queryFn: () => api<Desired>('/api/desired') });
  const [draft, setDraft] = useState<Desired | null>(null);
  const value = draft ?? q.data ?? null;
  const save = useMutation({
    mutationFn: (d: Desired) => api<Desired>('/api/desired', { method: 'PUT', body: d }),
  });
  return { q, value, setDraft, save };
}

function StorageStep({ label, onDone }: { label: string; onDone: () => void }) {
  const { q, value, setDraft, save } = useDesired();
  const check = useMutation({
    mutationFn: async () => {
      if (value) await save.mutateAsync(value);
      return post<HardlinkRow[]>('/api/storage/hardlink-check');
    },
  });
  if (!value)
    return (
      <Frame title="Armazenamento" step={label}>
        <ErrorNote error={q.error} />
        <Loader2 className="animate-spin" aria-label="A carregar" />
      </Frame>
    );
  const set = (f: (d: Desired) => void) => {
    const d = structuredClone(value);
    f(d);
    setDraft(d);
  };
  const broken = check.data?.some((r) => !r.ok);
  return (
    <Frame title="Onde ficam os ficheiros?" step={label}>
      <p className="muted text-sm">
        Todos os serviços veem a raiz de dados em <code>/data</code>. Torrents e bibliotecas têm de
        estar no mesmo volume para haver hardlinks.
      </p>
      <ErrorNote error={check.error ?? save.error} />
      <Field label="Torrents">
        <input
          className="input"
          value={value.downloads.torrentsRoot}
          onChange={(e) =>
            set((d) => {
              d.downloads.torrentsRoot = e.target.value;
            })
          }
        />
      </Field>
      <Field label="Biblioteca de séries">
        <input
          className="input"
          value={value.storage.tvRoot}
          onChange={(e) =>
            set((d) => {
              d.storage.tvRoot = e.target.value;
            })
          }
        />
      </Field>
      <Field label="Biblioteca de filmes">
        <input
          className="input"
          value={value.storage.moviesRoot}
          onChange={(e) =>
            set((d) => {
              d.storage.moviesRoot = e.target.value;
            })
          }
        />
      </Field>
      <Button onClick={() => check.mutate()} disabled={check.isPending}>
        Testar hardlinks
      </Button>
      {check.data && (
        <ul className="space-y-2" aria-live="polite">
          {check.data.map((r) => (
            <li key={r.to} className="flex items-start gap-2 text-sm">
              {r.ok ? (
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden />
              ) : (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" aria-hidden />
              )}
              <span>{r.ok ? `Hardlinks OK: ${r.from} → ${r.to}` : (r.message ?? 'Falhou')}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button
          variant="primary"
          onClick={async () => {
            await save.mutateAsync(value);
            onDone();
          }}
          disabled={save.isPending}
        >
          {broken ? 'Continuar mesmo assim' : 'Continuar'}
        </Button>
      </div>
    </Frame>
  );
}

function SubsStep({ label, onDone }: { label: string; onDone: () => void }) {
  const { value, setDraft, save } = useDesired();
  if (!value)
    return (
      <Frame title="Legendas" step={label}>
        <Loader2 className="animate-spin" aria-label="A carregar" />
      </Frame>
    );
  const langs = value.subtitles.languages;
  const toggle = (c: string) => {
    const d = structuredClone(value);
    d.subtitles.languages = langs.includes(c) ? langs.filter((x) => x !== c) : [...langs, c];
    setDraft(d);
  };
  return (
    <Frame title="Idiomas das legendas" step={label}>
      <p className="muted text-sm">
        Por ordem de preferência. A qualidade de vídeo (1080p / 4K) chega com os perfis TRaSH.
      </p>
      <ErrorNote error={save.error} />
      <fieldset className="space-y-2">
        <legend className="sr-only">Idiomas</legend>
        {LANGS.map(([code, name]) => (
          <label key={code} className="flex min-h-10 items-center gap-3">
            <input
              type="checkbox"
              checked={langs.includes(code)}
              onChange={() => toggle(code)}
              className="size-5"
            />
            {name}
          </label>
        ))}
      </fieldset>
      <Button
        variant="primary"
        disabled={!langs.length || save.isPending}
        onClick={async () => {
          await save.mutateAsync(value);
          onDone();
        }}
      >
        Continuar
      </Button>
    </Frame>
  );
}

function JellyfinStep({ label, onDone }: { label: string; onDone: () => void }) {
  const [f, setF] = useState({ hostname: '', port: '8096', username: '', password: '' });
  const m = useMutation({
    mutationFn: () => post('/api/seerr/setup', { ...f, port: Number(f.port) }),
    onSuccess: onDone,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Frame title="Ligar ao Jellyfin" step={label}>
      <p className="muted text-sm">
        O Seerr usa a conta de administrador do Jellyfin. As credenciais não ficam guardadas.
      </p>
      <ErrorNote error={m.error} />
      <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
        <Field
          label="Endereço do Jellyfin"
          hint="Visto a partir dos containers, ex.: 192.168.1.114"
        >
          <input className="input" value={f.hostname} onChange={set('hostname')} required />
        </Field>
        <Field label="Porta">
          <input
            className="input"
            inputMode="numeric"
            value={f.port}
            onChange={set('port')}
            required
          />
        </Field>
        <Field label="Utilizador">
          <input
            className="input"
            autoComplete="off"
            value={f.username}
            onChange={set('username')}
            required
          />
        </Field>
        <Field label="Palavra-passe">
          <input
            className="input"
            type="password"
            autoComplete="off"
            value={f.password}
            onChange={set('password')}
            required
          />
        </Field>
        <div className="flex gap-2">
          <Button variant="primary" type="submit" disabled={m.isPending}>
            {m.isPending ? 'A ligar…' : 'Ligar'}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Saltar por agora
          </Button>
        </div>
      </form>
    </Frame>
  );
}

function ApplyStep({ label, onDone }: { label: string; onDone: () => void }) {
  const plan = useQuery({ queryKey: ['wizard-plan'], queryFn: () => api<Plan>('/api/plan') });
  const apply = useMutation({
    mutationFn: async () => {
      const r = await post<{ applied: string[]; failed: { fieldId: string; error: string }[] }>(
        '/api/apply',
      );
      if (!r.failed.length) await post('/api/wizard/complete');
      return r;
    },
  });
  const services = [...new Set(plan.data?.changes.map((c) => c.service))];
  return (
    <Frame title="Aplicar a configuração" step={label}>
      <ErrorNote error={plan.error ?? apply.error} />
      {plan.data && !apply.data && (
        <p className="muted text-sm">
          {plan.data.changes.length
            ? `Vão ser alteradas ${plan.data.changes.length} definições em: ${services.join(', ')}.`
            : 'Tudo já está como pediste.'}
        </p>
      )}
      {apply.data && (
        <ul className="space-y-1 text-sm" aria-live="polite">
          {apply.data.applied.map((id) => (
            <li key={id} className="flex gap-2">
              <Check className="size-4 text-emerald-400" aria-hidden />
              {id}
            </li>
          ))}
          {apply.data.failed.map((x) => (
            <li key={x.fieldId} className="flex gap-2">
              <CircleAlert className="size-4 text-red-400" aria-hidden />
              {x.fieldId}: {x.error}
            </li>
          ))}
        </ul>
      )}
      {apply.data && !apply.data.failed.length ? (
        <Button variant="primary" onClick={onDone}>
          Concluir
        </Button>
      ) : (
        <Button
          variant="primary"
          onClick={() => apply.mutate()}
          disabled={apply.isPending || plan.isLoading}
        >
          {apply.isPending ? 'A aplicar…' : 'Aplicar'}
        </Button>
      )}
    </Frame>
  );
}
