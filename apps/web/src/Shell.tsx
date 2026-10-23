import { useQueryClient } from '@tanstack/react-query';
import {
  Anchor,
  CalendarDays,
  Clapperboard,
  DownloadCloud,
  Home,
  Inbox,
  LogOut,
  Moon,
  Search,
  Settings,
  Sun,
  Activity as Pulse,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { post } from './api';
import { useLang, useT } from './i18n';
import { Palette } from './Palette';
import { Button } from './ui';

const nav = [
  { to: '/', label: 'Início', icon: Home, end: true },
  { to: '/biblioteca', label: 'Biblioteca', icon: Clapperboard },
  { to: '/pedidos', label: 'Pedidos', icon: Inbox },
  { to: '/atividade', label: 'Atividade', icon: DownloadCloud },
  { to: '/calendario', label: 'Calendário', icon: CalendarDays },
  { to: '/definicoes', label: 'Definições', icon: Settings },
  { to: '/sistema', label: 'Sistema', icon: Pulse },
];

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('cais-theme') !== 'light';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('cais-theme', dark ? 'dark' : 'light');
    } catch {
      /* armazenamento indisponível */
    }
  }, [dark]);
  return [dark, () => setDark((d) => !d)] as const;
}

export function Shell({ user }: { user: string }) {
  const t = useT();
  const { lang, setLang } = useLang();
  const [dark, toggle] = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]">
      <aside
        className="hidden border-r p-4 md:flex md:flex-col"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="mb-6 flex items-center gap-2 px-2">
          <Anchor className="size-6" style={{ color: 'var(--accent)' }} aria-hidden />
          <span className="text-lg font-semibold">Cais</span>
        </div>
        <nav aria-label={t('Principal')} className="flex flex-1 flex-col gap-1">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
              <n.icon className="size-5" aria-hidden />
              {t(n.label)}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 flex flex-col gap-2">
          <Button variant="ghost" onClick={() => setPaletteOpen(true)}>
            <Search className="size-4" aria-hidden /> Pesquisar{' '}
            <kbd className="muted ml-auto text-xs">⌘K</kbd>
          </Button>
          <Button
            variant="ghost"
            onClick={toggle}
            aria-label={dark ? t('Mudar para tema claro') : t('Mudar para tema escuro')}
          >
            {dark ? (
              <Sun className="size-4" aria-hidden />
            ) : (
              <Moon className="size-4" aria-hidden />
            )}
            {dark ? t('Tema claro') : t('Tema escuro')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setLang(lang === 'pt' ? 'en' : 'pt')}
            aria-label={t('Mudar idioma')}
          >
            {lang === 'pt' ? 'English' : 'Português'}
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await post('/api/auth/logout');
              await qc.invalidateQueries({ queryKey: ['me'] });
            }}
          >
            <LogOut className="size-4" aria-hidden /> {t('Sair ({user})', { user })}
          </Button>
        </div>
      </aside>

      <div className="pb-20 md:pb-0">
        <header
          className="flex items-center justify-between border-b p-3 md:hidden"
          style={{ borderColor: 'var(--border)' }}
        >
          <span className="flex items-center gap-2 font-semibold">
            <Anchor className="size-5" style={{ color: 'var(--accent)' }} aria-hidden /> Cais
          </span>
          <span className="flex gap-1">
            <Button
              variant="ghost"
              onClick={() => setPaletteOpen(true)}
              aria-label={t('Pesquisar')}
            >
              <Search className="size-5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              onClick={toggle}
              aria-label={dark ? t('Tema claro') : t('Tema escuro')}
            >
              {dark ? (
                <Sun className="size-5" aria-hidden />
              ) : (
                <Moon className="size-5" aria-hidden />
              )}
            </Button>
          </span>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label={t('Principal (telemóvel)')}
        className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t p-1 md:hidden"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {nav.slice(0, 5).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className="nav-link flex-col !gap-0.5 !px-2 text-[0.7rem]"
          >
            <n.icon className="size-5" aria-hidden />
            {t(n.label)}
          </NavLink>
        ))}
        <NavLink to="/definicoes" className="nav-link flex-col !gap-0.5 !px-2 text-[0.7rem]">
          <Settings className="size-5" aria-hidden />
          {t('Mais')}
        </NavLink>
      </nav>

      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
