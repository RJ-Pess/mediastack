import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Clapperboard,
  DownloadCloud,
  Home,
  Languages,
  Layers,
  LogOut,
  Moon,
  Monitor,
  Search,
  Settings,
  Sun,
  Activity as Pulse,
} from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api, post } from './api';
import { useLang, useT } from './i18n';
import { Palette } from './Palette';
import { IconTile } from './ui';

interface OverviewCounts {
  counts: { downloading: number; pendingRequests: number | null };
}

/** Cada secção tem a sua cor (quadrado do ícone e realce quando ativa). */
const nav = [
  { to: '/', label: 'Início', icon: Home, color: 'var(--c-violet)', end: true },
  { to: '/seerr', label: 'Seerr', icon: Monitor, color: 'var(--c-teal)' },
  { to: '/biblioteca', label: 'Biblioteca', icon: Clapperboard, color: 'var(--c-sky)' },
  {
    to: '/atividade',
    label: 'Atividade',
    icon: DownloadCloud,
    color: 'var(--c-emerald)',
    badge: 'downloads',
  },
  { to: '/calendario', label: 'Calendário', icon: CalendarDays, color: 'var(--c-rose)' },
  { to: '/definicoes', label: 'Definições', icon: Settings, color: 'var(--c-slate)' },
  { to: '/sistema', label: 'Sistema', icon: Pulse, color: 'var(--c-slate)' },
] as const;

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('mediastack-theme') !== 'light';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('mediastack-theme', dark ? 'dark' : 'light');
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const current =
    nav.find((n) => (n.to === '/' ? pathname === '/' : pathname.startsWith(n.to))) ?? nav[0];

  // Partilha a query do Início: os contadores da barra lateral não fazem pedidos extra.
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: () => api<OverviewCounts>('/api/overview'),
    refetchInterval: 15_000,
  });
  const badges: Record<string, number> = {
    downloads: overview.data?.counts.downloading ?? 0,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === 'Escape') setMenuOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, []);

  const logout = async () => {
    await post('/api/auth/logout');
    await qc.invalidateQueries({ queryKey: ['me'] });
  };

  return (
    <div className="min-h-screen md:grid md:grid-cols-[16.5rem_1fr] md:gap-4 md:p-4">
      <aside className="panel sticky top-4 hidden h-[calc(100vh-2rem)] flex-col !p-3 md:flex">
        <div className="mb-5 flex items-center gap-2.5 px-2 pt-1">
          <span
            className="grid size-9 place-items-center rounded-xl"
            style={{
              background: 'linear-gradient(135deg, var(--accent-2), var(--c-teal))',
              color: 'var(--accent-text)',
            }}
          >
            <Layers className="size-5" aria-hidden />
          </span>
          <span className="text-lg font-bold tracking-tight">MediaStack</span>
        </div>
        <nav aria-label={t('Principal')} className="flex flex-1 flex-col gap-1">
          {nav.map((n) => {
            const count = 'badge' in n ? badges[n.badge] : 0;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={'end' in n ? n.end : false}
                className="nav-link"
                style={{ '--tile': n.color } as CSSProperties}
              >
                <IconTile icon={n.icon} color={n.color} />
                {t(n.label)}
                {count ? (
                  <span className="count-badge" aria-label={t('{n} pendentes', { n: count })}>
                    {count}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>
        <p className="muted px-2 pb-1 text-xs">{t('Painel único para a tua stack de media')}</p>
      </aside>

      <div className="flex min-w-0 flex-col pb-24 md:pb-0">
        {/* Barra de topo */}
        <header className="panel sticky top-0 z-20 flex items-center gap-3 !rounded-none !p-3 md:top-4 md:!rounded-[var(--radius)]">
          <span
            className="dot hidden md:inline-block"
            style={{ background: current.color }}
            aria-hidden
          />
          <span className="flex items-center gap-2 font-bold md:hidden">
            <Layers className="size-5" style={{ color: 'var(--accent)' }} aria-hidden />
            MediaStack
          </span>
          <p className="hidden text-xl font-bold tracking-tight md:block" aria-hidden>
            {t(current.label)}
          </p>
          <button
            type="button"
            className="input ml-auto flex max-w-md flex-1 items-center gap-2 text-left md:ml-4"
            onClick={() => setPaletteOpen(true)}
            aria-label={t('Pesquisar')}
          >
            <Search className="muted size-4 shrink-0" aria-hidden />
            <span className="muted hidden truncate text-sm sm:inline">
              {t('Pesquisar filmes e séries…')}
            </span>
            <kbd className="muted mono ml-auto hidden text-xs sm:inline">⌘K</kbd>
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={toggle}
            aria-label={dark ? t('Mudar para tema claro') : t('Mudar para tema escuro')}
          >
            {dark ? (
              <Sun className="size-5" aria-hidden />
            ) : (
              <Moon className="size-5" aria-hidden />
            )}
          </button>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              className="grid size-10 place-items-center rounded-full font-bold"
              style={{
                background: 'linear-gradient(135deg, var(--accent-2), var(--c-teal))',
                color: 'var(--accent-text)',
              }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t('Conta de {user}', { user })}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {user.slice(0, 1).toUpperCase()}
            </button>
            {menuOpen && (
              <div role="menu" className="panel absolute right-0 top-12 z-30 w-56 space-y-1 !p-2">
                <p className="muted px-2 py-1 text-xs">{user}</p>
                <button
                  type="button"
                  role="menuitem"
                  className="nav-link w-full"
                  onClick={() => setLang(lang === 'pt' ? 'en' : 'pt')}
                >
                  <Languages className="size-4" aria-hidden />
                  {lang === 'pt' ? 'English' : 'Português'}
                </button>
                <button type="button" role="menuitem" className="nav-link w-full" onClick={logout}>
                  <LogOut className="size-4" aria-hidden />
                  {t('Sair')}
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-0">
          <Outlet />
        </main>
      </div>

      {/* Telemóvel: barra inferior + menu "Mais" */}
      <nav
        aria-label={t('Principal (telemóvel)')}
        className="panel fixed inset-x-2 bottom-2 z-20 flex justify-around !p-1 md:hidden"
      >
        {nav.slice(0, 4).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={'end' in n ? n.end : false}
            className="nav-link flex-col !gap-0.5 !px-2 text-[0.7rem]"
            style={{ '--tile': n.color } as CSSProperties}
          >
            <n.icon className="size-5" aria-hidden />
            {t(n.label)}
          </NavLink>
        ))}
        <button
          type="button"
          className="nav-link flex-col !gap-0.5 !px-2 text-[0.7rem]"
          aria-expanded={moreOpen}
          aria-controls="more-menu"
          onClick={() => setMoreOpen((o) => !o)}
        >
          <Settings className="size-5" aria-hidden />
          {t('Mais')}
        </button>
      </nav>
      {moreOpen && (
        <div
          id="more-menu"
          className="panel fixed inset-x-2 bottom-20 z-30 space-y-1 !p-2 md:hidden"
          onClick={() => setMoreOpen(false)}
        >
          {nav.slice(4).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className="nav-link"
              style={{ '--tile': n.color } as CSSProperties}
            >
              <IconTile icon={n.icon} color={n.color} />
              {t(n.label)}
            </NavLink>
          ))}
          <button
            type="button"
            className="nav-link w-full"
            onClick={() => setLang(lang === 'pt' ? 'en' : 'pt')}
          >
            <Languages className="size-4" aria-hidden />
            {lang === 'pt' ? 'English' : 'Português'}
          </button>
          <button type="button" className="nav-link w-full" onClick={logout}>
            <LogOut className="size-4" aria-hidden /> {t('Sair ({user})', { user })}
          </button>
        </div>
      )}

      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
