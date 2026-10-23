import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en } from './locales/en';

export type Lang = 'pt' | 'en';
type Vars = Record<string, string | number>;

/**
 * i18n mínimo: a chave é a frase em português (língua de origem); o dicionário EN traduz.
 * Frases sem tradução ficam em português em vez de partir a UI.
 */
export type T = (key: string, vars?: Vars) => string;

const I18n = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: T }>({
  lang: 'pt',
  setLang: () => undefined,
  t: (k) => k,
});

const initial = (): Lang => {
  try {
    const saved = localStorage.getItem('mediastack-lang');
    if (saved === 'pt' || saved === 'en') return saved;
  } catch {
    /* armazenamento indisponível */
  }
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'pt';
};

const interpolate = (s: string, vars?: Vars) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k] ?? m)) : s;

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('mediastack-lang', l);
    } catch {
      /* ignorar */
    }
  };
  useEffect(() => {
    document.documentElement.lang = lang === 'pt' ? 'pt-PT' : 'en';
  }, [lang]);
  const value = useMemo(
    () => ({
      lang,
      setLang,
      t: ((key, vars) => interpolate(lang === 'en' ? (en[key] ?? key) : key, vars)) as T,
    }),
    [lang],
  );
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export const useT = () => useContext(I18n).t;
export const useLang = () => {
  const { lang, setLang } = useContext(I18n);
  return { lang, setLang, locale: lang === 'pt' ? 'pt-PT' : 'en-GB' };
};
