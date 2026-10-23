import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, fmtBytes, post } from '../api';
import { useLang, useT } from '../i18n';
import { Button, Card, ErrorNote, Skeleton } from '../ui';

interface Backup {
  service: string;
  name: string;
  type: string;
  size: number;
  time: string;
}

/** Backups nativos do Sonarr/Radarr/Prowlarr + exportar/importar o estado desejado (YAML). */
export function Backups() {
  const t = useT();
  const { locale } = useLang();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [withSecrets, setWithSecrets] = useState(false);
  const [importSecrets, setImportSecrets] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useQuery({ queryKey: ['backups'], queryFn: () => api<Backup[]>('/api/backups') });
  const run = useMutation({
    mutationFn: () => post<{ ok: boolean }[]>('/api/backups/run'),
    // Os serviços fazem o backup em segundo plano; refresca passado um momento.
    onSuccess: () => setTimeout(() => void qc.invalidateQueries({ queryKey: ['backups'] }), 4000),
  });

  const exportFile = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/export${withSecrets ? '?secrets=1' : ''}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mediastack-config.yaml';
      a.click();
      URL.revokeObjectURL(url);
    },
  });
  const importFile = useMutation({
    mutationFn: async (f: File) =>
      post<{ secretsImported: number }>('/api/import', {
        yaml: await f.text(),
        secrets: importSecrets,
      }),
    onSuccess: async () => {
      setNotice(t('Configuração importada. Revê o plano e aplica.'));
      await Promise.all(
        ['desired', 'plan', 'drift'].map((k) => qc.invalidateQueries({ queryKey: [k] })),
      );
    },
  });

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-semibold">{t('Backup e restauro')}</h2>
        <p className="muted text-xs">
          {t('Afeta: {services}', { services: 'MediaStack, Sonarr, Radarr, Prowlarr' })}
        </p>
      </div>
      <ErrorNote error={list.error ?? run.error ?? exportFile.error ?? importFile.error} />
      {notice && (
        <p role="status" className="text-sm" style={{ color: 'var(--ok)' }}>
          {notice}
        </p>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t('Configuração do MediaStack (YAML)')}</h3>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={withSecrets}
            onChange={(e) => setWithSecrets(e.target.checked)}
          />
          {t('Incluir segredos (cifrados)')}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => exportFile.mutate()} disabled={exportFile.isPending}>
            <Download className="size-4" aria-hidden /> {t('Exportar')}
          </Button>
          <Button onClick={() => file.current?.click()} disabled={importFile.isPending}>
            <Upload className="size-4" aria-hidden /> {t('Importar')}
          </Button>
          <input
            ref={file}
            type="file"
            accept=".yaml,.yml,text/yaml"
            className="sr-only"
            aria-label={t('Ficheiro YAML a importar')}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile.mutate(f);
              e.target.value = '';
            }}
          />
        </div>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={importSecrets}
            onChange={(e) => setImportSecrets(e.target.checked)}
          />
          {t('Importar também os segredos do ficheiro')}
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t('Backups dos serviços')}</h3>
          <Button onClick={() => run.mutate()} disabled={run.isPending}>
            {t('Fazer backup agora')}
          </Button>
        </div>
        {list.isLoading ? (
          <Skeleton className="h-16" />
        ) : list.data?.length ? (
          <ul className="max-h-56 space-y-1 overflow-auto text-xs">
            {list.data.slice(0, 12).map((b) => (
              <li key={`${b.service}${b.name}`}>
                <b className="capitalize">{b.service}</b> ·{' '}
                <time dateTime={b.time}>{new Date(b.time).toLocaleString(locale)}</time> · {b.type}{' '}
                · {fmtBytes(b.size)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted text-sm">{t('Ainda não há backups.')}</p>
        )}
        <p className="muted text-xs">
          {t('Os backups ficam na pasta de configuração de cada serviço.')}
        </p>
      </div>
    </Card>
  );
}
