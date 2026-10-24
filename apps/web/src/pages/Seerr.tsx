import { useState, useRef } from 'react';
import { AlertCircle, ExternalLink, RefreshCw } from 'lucide-react';
import { useT } from '../i18n';
import { Button, Card, PageHeader } from '../ui';

/** Janela tipo browser que incorpora o Jellyseerr (serr) dentro do MediaStack. */
const STORAGE_KEY = 'mediastack-seerr-url';
const EXEMPLO = 'http://localhost:5055';

export function Seerr() {
  const t = useT();
  const [url, setUrl] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [editing, setEditing] = useState(!url);
  const [error, setError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Quando não há endereço externo, usa o proxy interno do MediaStack
  // (/api/seerr-proxy) que encaminha para o Seerr na rede interna do Docker.
  const src = url || '/api/seerr-proxy';

  const guardar = () => {
    try {
      localStorage.setItem(STORAGE_KEY, url.trim());
    } catch {
      /* armazenamento indisponível */
    }
    setEditing(false);
    setError(false);
  };

  const abrirNoNavegador = () => {
    if (url) window.open(url, '_blank');
  };

  const recarregar = () => {
    iframeRef.current?.contentWindow?.location.reload();
    setError(false);
  };

  return (
    <>
      <PageHeader title={t('Seerr')} />
      {editing || (!url && error) ? (
        <Card className="space-y-3">
          <div>
            <h2 className="font-semibold">{t('Seerr')}</h2>
            <p className="muted text-sm">
              {t(
                'Indique o endereço onde o Jellyseerr está acessível. O MediaStack não publica a porta do Seerr por defeito.',
              )}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 items-end">
            <label className="flex flex-col gap-1">
              <span className="text-sm">{t('Endereço do Seerr')}</span>
              <input
                id="seerr-url"
                className="input"
                placeholder={EXEMPLO}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <Button variant="primary" onClick={guardar}>
                {t('Guardar')}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                {t('Cancelar')}
              </Button>
            </div>
            <p className="muted text-xs col-span-full">{t('Exemplo: http://localhost:5055')}</p>
          </div>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className="truncate flex-1 text-sm">
              {url || t('Proxy interno do MediaStack')}
            </span>
            {!url && (
              <span className="text-xs muted">
                ({t('Sem endereço configurado — a usar proxy interno')})
              </span>
            )}
            <Button variant="ghost" onClick={recarregar} aria-label={t('Recarregar')}>
              <RefreshCw className="size-4" aria-hidden />
            </Button>
            <Button variant="ghost" onClick={recarregar} aria-label={t('Recarregar')}>
              <RefreshCw className="size-4" aria-hidden />
            </Button>
            {url ? (
              <Button
                variant="ghost"
                onClick={abrirNoNavegador}
                aria-label={t('Abrir no navegador')}
              >
                <ExternalLink className="size-4" aria-hidden />
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setEditing(true)}>
              {t('Editar endereço')}
            </Button>
          </div>
          <div className="rounded-lg border overflow-hidden flex-1 min-h-[600px] relative">
            <iframe
              ref={iframeRef}
              src={src}
              title={t('Seerr')}
              className="w-full h-full block"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
              allow="autoplay *; clipboard-read *; clipboard-write *; picture-in-picture *"
              loading="eager"
              onLoad={() => setError(false)}
              onError={() => setError(true)}
            />
            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-black/5 backdrop-blur-sm">
                <AlertCircle className="size-12 mb-2 text-yellow-500" aria-hidden />
                <p className="text-sm">
                  {t('Não foi possível carregar o Seerr. Verifique o endereço.')}
                </p>
                {!url && (
                  <Button variant="ghost" onClick={() => setEditing(true)}>
                    {t('Configurar endereço')}
                  </Button>
                )}
                {url && (
                  <Button variant="ghost" onClick={recarregar}>
                    {t('Recarregar')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
