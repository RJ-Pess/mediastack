import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../i18n';
import { Card } from '../ui';

const SERVICES = ['Sonarr', 'Radarr', 'Prowlarr', 'Bazarr', 'qBittorrent', 'Seerr'] as const;
const KEY = 'mediastack-native-urls';

const load = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
};

/** Avançado: atalhos para a UI nativa de cada serviço (só neste browser; os serviços não são publicados por defeito). */
export function NativeUis() {
  const t = useT();
  const [urls, setUrls] = useState<Record<string, string>>(load);
  const set = (name: string, value: string) => {
    const next = { ...urls, [name]: value };
    setUrls(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* armazenamento indisponível */
    }
  };
  const safe = (u: string | undefined) => (u && /^https?:\/\//.test(u) ? u : null);

  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-semibold">{t('Avançado: UI nativa dos serviços')}</h2>
        <p className="muted text-xs">
          {t(
            'Por defeito os serviços não são publicados no host. Se publicares uma porta, indica aqui o endereço.',
          )}
        </p>
      </div>
      <ul className="space-y-2">
        {SERVICES.map((name) => {
          const href = safe(urls[name]);
          return (
            <li key={name} className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-sm" htmlFor={`native-${name}`}>
                {name}
              </label>
              <input
                id={`native-${name}`}
                className="input"
                placeholder="http://192.168.1.10:8989"
                value={urls[name] ?? ''}
                onChange={(e) => set(name, e.target.value)}
              />
              {href ? (
                <a
                  className="btn"
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={t('Abrir {name}', { name })}
                >
                  <ExternalLink className="size-4" aria-hidden />
                </a>
              ) : (
                <span className="btn opacity-40" aria-hidden>
                  <ExternalLink className="size-4" />
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
