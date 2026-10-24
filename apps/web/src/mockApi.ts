import type { Plugin } from 'vite';

export function mockApiPlugin(): Plugin {
  let meState: { configured: boolean; user: string | null; wizardDone: boolean } = {
    configured: true,
    user: 'admin',
    wizardDone: true,
  };

  let desiredState = {
    quality: { profile: '1080p' as const },
    subtitles: { languages: ['pt', 'en'] },
    storage: {
      tvRoot: '/data/media/tv',
      moviesRoot: '/data/media/movies',
      extraTvRoots: [] as string[],
      extraMoviesRoots: [] as string[],
    },
    downloads: {
      torrentsRoot: '/data/torrents',
      categories: { tv: 'tv', movies: 'movies' },
      downKiBps: 0,
      upKiBps: 0,
      seedRatio: 2,
    },
  };

  interface MockRequestItem {
    id: number;
    mediaType: string;
    tmdbId: number;
    title: string;
    year: number;
    status: number;
    requestedBy: string;
    createdAt: string;
    poster: string | null;
  }

  const requestsList: MockRequestItem[] = [
    {
      id: 1,
      mediaType: 'movie',
      tmdbId: 1022789,
      title: 'Inside Out 2',
      year: 2024,
      status: 1,
      requestedBy: 'admin',
      createdAt: new Date().toISOString(),
      poster: 'https://image.tmdb.org/t/p/w500/vpnVM9B6NMmQpWeZvzLvDESb2QY.jpg',
    },
  ];

  const dismissedList: { key: string; title: string }[] = [];

  return {
    name: 'mediastack-mock-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlStr = req.url || '';
        if (!urlStr.startsWith('/api/')) {
          return next();
        }

        const parsedUrl = new URL(urlStr, 'http://localhost:3000');
        const pathname = parsedUrl.pathname;
        const method = req.method?.toUpperCase() || 'GET';

        const json = (data: unknown, status = 200) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        };

        // Read body helper
        const readBody = async (): Promise<Record<string, any>> => {
          return new Promise((resolve) => {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk;
            });
            req.on('end', () => {
              try {
                resolve(body ? JSON.parse(body) : {});
              } catch {
                resolve({});
              }
            });
          });
        };

        // 1. Auth & Me
        if (pathname === '/api/auth/me') {
          return json(meState);
        }
        if (pathname === '/api/auth/login') {
          const body = await readBody();
          meState.user = body.username || 'admin';
          return json({ ok: true, user: meState.user });
        }
        if (pathname === '/api/auth/setup') {
          const body = await readBody();
          meState.configured = true;
          meState.user = body.username || 'admin';
          return json({ ok: true });
        }
        if (pathname === '/api/auth/logout') {
          meState.user = null;
          return json({ ok: true });
        }
        if (pathname === '/api/wizard/complete') {
          meState.wizardDone = true;
          return json({ ok: true });
        }

        // 2. Status & Overview
        if (pathname === '/api/status') {
          return json({
            services: [
              { service: 'jellyfin', state: 'up', name: 'Jellyfin', url: 'http://localhost:8096' },
              { service: 'sonarr', state: 'up', name: 'Sonarr', url: 'http://localhost:8989' },
              { service: 'radarr', state: 'up', name: 'Radarr', url: 'http://localhost:7878' },
              { service: 'prowlarr', state: 'up', name: 'Prowlarr', url: 'http://localhost:9696' },
              { service: 'qbittorrent', state: 'up', name: 'qBittorrent', url: 'http://localhost:8080' },
              { service: 'bazarr', state: 'up', name: 'Bazarr', url: 'http://localhost:6767' },
              { service: 'seerr', state: 'up', name: 'Seerr', url: 'http://localhost:5055' },
            ],
          });
        }

        if (pathname === '/api/overview') {
          return json({
            counts: {
              downloading: 2,
              queued: 1,
              missing: 4,
              healthIssues: 0,
              pendingRequests: requestsList.length,
            },
            server: {
              cpuPct: 18,
              memUsed: 4500000000,
              memTotal: 17179869184,
              diskUsed: 2400000000000,
              diskTotal: 8000000000000,
            },
            media: {
              movies: { total: 342, downloaded: 338, missing: 4 },
              series: { total: 56, episodes: 1840, episodesTotal: 1890 },
            },
            recent: [
              {
                key: 'movie:1',
                kind: 'movie',
                title: 'Dune: Part Two',
                year: 2024,
                poster: 'https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
                badge: 'available',
              },
              {
                key: 'series:1',
                kind: 'series',
                title: 'Severance',
                year: 2022,
                poster: 'https://image.tmdb.org/t/p/w500/1XddMrb7U5bZ9koc54j8i79wz8C.jpg',
                badge: 'available',
                detail: 'T1 E9',
              },
              {
                key: 'movie:2',
                kind: 'movie',
                title: 'Oppenheimer',
                year: 2023,
                poster: 'https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
                badge: 'available',
              },
            ],
            upcoming: [
              {
                key: 'movie:3',
                kind: 'movie',
                title: 'Gladiator II',
                year: 2024,
                poster: 'https://image.tmdb.org/t/p/w500/2cxhvwyEwRlysAmRH4iodkvo0z5.jpg',
                badge: 'downloading',
                progress: 0.68,
              },
              {
                key: 'series:2',
                kind: 'series',
                title: 'The Last of Us',
                year: 2023,
                poster: 'https://image.tmdb.org/t/p/w500/uKvVjHNqB5VmOrdxqAt2V7JMrRI.jpg',
                badge: 'missing',
              },
            ],
          });
        }

        // 3. Activity
        if (pathname === '/api/activity') {
          return json({
            torrents: [
              {
                hash: '4a5b6c7d8e9f0123456789abcdef0123456789ab',
                name: 'Gladiator.II.2024.2160p.UHD.BluRay.x265',
                progress: 0.68,
                size: 22400000000,
                state: 'downloading',
                eta: 420,
                dlspeed: 35600000,
                upspeed: 1500000,
              },
              {
                hash: '1f2e3d4c5b6a7890abcdef1234567890abcdef12',
                name: 'Severance.S02E01.1080p.WEB-DL.DDP5.1.Atmos',
                progress: 0.15,
                size: 3200000000,
                state: 'downloading',
                eta: 90,
                dlspeed: 28400000,
                upspeed: 800000,
              },
            ],
            queue: [],
          });
        }
        if (pathname.startsWith('/api/activity/') && method === 'POST') {
          return json({ ok: true });
        }
        if (pathname === '/api/activity/history') {
          return json([]);
        }
        if (pathname === '/api/activity/blocklist') {
          return json([]);
        }

        // 4. Calendar
        if (pathname === '/api/calendar') {
          return json([
            { date: '2026-10-25', title: 'Severance', subtitle: 'T2 E1 · Premiere' },
            { date: '2026-10-28', title: 'Dune: Prophecy', subtitle: 'T1 E4' },
            { date: '2026-11-02', title: 'Gladiator II', subtitle: 'Lançamento Digital' },
            { date: '2026-11-05', title: 'Arcane', subtitle: 'T2 E1' },
          ]);
        }

        // 5. Library
        if (pathname === '/api/library') {
          return json({
            movies: [
              {
                id: 1,
                title: 'Dune: Part Two',
                year: 2024,
                hasFile: true,
                monitored: true,
                size: 18200000000,
                quality: '2160p',
                poster: 'https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
              },
              {
                id: 2,
                title: 'Oppenheimer',
                year: 2023,
                hasFile: true,
                monitored: true,
                size: 24500000000,
                quality: '2160p',
                poster: 'https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
              },
              {
                id: 3,
                title: 'Interstellar',
                year: 2014,
                hasFile: true,
                monitored: true,
                size: 14200000000,
                quality: '1080p',
                poster: 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
              },
            ],
            series: [
              {
                id: 1,
                title: 'Severance',
                year: 2022,
                episodeCount: 9,
                totalEpisodeCount: 9,
                monitored: true,
                poster: 'https://image.tmdb.org/t/p/w500/1XddMrb7U5bZ9koc54j8i79wz8C.jpg',
              },
              {
                id: 2,
                title: 'Succession',
                year: 2018,
                episodeCount: 39,
                totalEpisodeCount: 39,
                monitored: true,
                poster: 'https://image.tmdb.org/t/p/w500/7TafV09lF14e5aWzH1GvF2m9U8U.jpg',
              },
            ],
          });
        }
        if (pathname === '/api/library/bulk') {
          return json({ ok: true });
        }

        // 6. Discover
        if (pathname === '/api/discover/genres') {
          return json([
            { id: 28, name: 'Ação' },
            { id: 12, name: 'Aventura' },
            { id: 16, name: 'Animação' },
            { id: 35, name: 'Comédia' },
            { id: 80, name: 'Crime' },
            { id: 18, name: 'Drama' },
            { id: 878, name: 'Ficção Científica' },
            { id: 53, name: 'Thriller' },
          ]);
        }
        if (pathname === '/api/discover/rows') {
          return json([
            {
              id: 'trending',
              items: [
                {
                  tmdbId: 912649,
                  mediaType: 'movie',
                  title: 'Venom: The Last Dance',
                  year: '2024',
                  poster: 'https://image.tmdb.org/t/p/w500/aosm8Vh99xcBGvtY9hdmgUpJWAc.jpg',
                  rating: 6.8,
                  genreIds: [28, 878],
                  mediaStatus: 1,
                },
                {
                  tmdbId: 558449,
                  mediaType: 'movie',
                  title: 'Gladiator II',
                  year: '2024',
                  poster: 'https://image.tmdb.org/t/p/w500/2cxhvwyEwRlysAmRH4iodkvo0z5.jpg',
                  rating: 7.2,
                  genreIds: [28, 12, 18],
                  mediaStatus: 2,
                },
                {
                  tmdbId: 933260,
                  mediaType: 'tv',
                  title: 'The Penguin',
                  year: '2024',
                  poster: 'https://image.tmdb.org/t/p/w500/ae43Zs9Fl5rhk7lzC6968m59r5M.jpg',
                  rating: 8.6,
                  genreIds: [18, 80],
                  mediaStatus: 4,
                },
              ],
            },
            {
              id: 'similar',
              items: [
                {
                  tmdbId: 693134,
                  mediaType: 'movie',
                  title: 'Dune: Part Two',
                  year: '2024',
                  poster: 'https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
                  rating: 8.2,
                  genreIds: [878, 12],
                  mediaStatus: 4,
                },
                {
                  tmdbId: 438631,
                  mediaType: 'movie',
                  title: 'Dune',
                  year: '2021',
                  poster: 'https://image.tmdb.org/t/p/w500/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
                  rating: 7.9,
                  genreIds: [878, 12],
                  mediaStatus: 4,
                },
              ],
            },
          ]);
        }
        if (pathname === '/api/discover') {
          return json({
            items: [
              {
                tmdbId: 912649,
                mediaType: 'movie',
                title: 'Venom: The Last Dance',
                year: '2024',
                poster: 'https://image.tmdb.org/t/p/w500/aosm8Vh99xcBGvtY9hdmgUpJWAc.jpg',
                rating: 6.8,
                genreIds: [28, 878],
                mediaStatus: 1,
              },
              {
                tmdbId: 558449,
                mediaType: 'movie',
                title: 'Gladiator II',
                year: '2024',
                poster: 'https://image.tmdb.org/t/p/w500/2cxhvwyEwRlysAmRH4iodkvo0z5.jpg',
                rating: 7.2,
                genreIds: [28, 12, 18],
                mediaStatus: 2,
              },
              {
                tmdbId: 933260,
                mediaType: 'tv',
                title: 'The Penguin',
                year: '2024',
                poster: 'https://image.tmdb.org/t/p/w500/ae43Zs9Fl5rhk7lzC6968m59r5M.jpg',
                rating: 8.6,
                genreIds: [18, 80],
                mediaStatus: 4,
              },
              {
                tmdbId: 1022789,
                mediaType: 'movie',
                title: 'Inside Out 2',
                year: '2024',
                poster: 'https://image.tmdb.org/t/p/w500/vpnVM9B6NMmQpWeZvzLvDESb2QY.jpg',
                rating: 7.6,
                genreIds: [16, 35, 12],
                mediaStatus: 2,
              },
            ],
            page: 1,
            totalPages: 1,
          });
        }
        if (pathname === '/api/discover/dismissed') {
          if (method === 'POST') {
            const body = await readBody();
            dismissedList.push({
              key: `${body.mediaType}:${body.tmdbId}`,
              title: body.title || `${body.mediaType}:${body.tmdbId}`,
            });
            return json({ ok: true });
          }
          return json(dismissedList);
        }
        if (pathname.startsWith('/api/discover/dismissed/') && method === 'DELETE') {
          const key = decodeURIComponent(pathname.replace('/api/discover/dismissed/', ''));
          const idx = dismissedList.findIndex((d) => d.key === key);
          if (idx !== -1) dismissedList.splice(idx, 1);
          return json({ ok: true });
        }

        // 7. Requests
        if (pathname === '/api/requests') {
          return json(requestsList);
        }
        if (pathname.startsWith('/api/requests/') && pathname.endsWith('/approve')) {
          const id = Number(pathname.split('/')[3]);
          const found = requestsList.find((r) => r.id === id);
          if (found) found.status = 2;
          return json({ ok: true });
        }
        if (pathname === '/api/request' && method === 'POST') {
          const body = await readBody();
          requestsList.push({
            id: requestsList.length + 1,
            mediaType: body.mediaType || 'movie',
            tmdbId: body.tmdbId || 0,
            title: body.title || `Item #${body.tmdbId}`,
            year: 2024,
            status: 1,
            requestedBy: meState.user || 'admin',
            createdAt: new Date().toISOString(),
            poster: null,
          });
          return json({ ok: true });
        }

        // 8. Settings & Configuration
        if (pathname === '/api/desired') {
          if (method === 'PUT') {
            const body = await readBody();
            desiredState = { ...desiredState, ...body };
            return json(desiredState);
          }
          return json(desiredState);
        }
        if (pathname === '/api/plan') {
          return json({ changes: [], errors: [] });
        }
        if (pathname === '/api/apply') {
          return json({ applied: ['plan.applied'], failed: [] });
        }
        if (pathname === '/api/drift') {
          return json({ changes: [], errors: [] });
        }
        if (pathname === '/api/notifications') {
          return json({ hasSecret: true });
        }
        if (pathname === '/api/quality') {
          return json({
            requested: desiredState.quality,
            sync: { lastSync: new Date().toISOString(), status: 'synced' },
          });
        }
        if (pathname === '/api/indexers') {
          return json([
            { id: 1, name: '1337x', protocol: 'torrent', enabled: true },
            { id: 2, name: 'TorrentGalaxy', protocol: 'torrent', enabled: true },
          ]);
        }
        if (pathname === '/api/backups') {
          return json([
            { id: 'backup-current', date: new Date().toISOString(), sizeBytes: 15400000 },
          ]);
        }
        if (pathname === '/api/adopt') {
          return json({ external: false, connections: {} });
        }
        if (pathname === '/api/audit') {
          return json([]);
        }

        // 9. System & Storage check
        if (pathname === '/api/system') {
          return json({
            cpu: { model: 'AMD EPYC', cores: 8, usagePct: 18 },
            memory: {
              totalBytes: 17179869184,
              usedBytes: 4500000000,
              freeBytes: 12679869184,
            },
            disks: [
              {
                mount: '/data',
                filesystem: 'ext4',
                totalBytes: 8000000000000,
                usedBytes: 2400000000000,
                freeBytes: 5600000000000,
              },
            ],
            os: { platform: 'linux', distro: 'Debian GNU/Linux 12', uptimeSeconds: 345600 },
            docker: { running: true, containers: 7 },
          });
        }
        if (pathname === '/api/storage/hardlink-check') {
          return json([
            {
              from: desiredState.downloads.torrentsRoot,
              to: desiredState.storage.tvRoot,
              ok: true,
            },
            {
              from: desiredState.downloads.torrentsRoot,
              to: desiredState.storage.moviesRoot,
              ok: true,
            },
          ]);
        }
        if (pathname === '/api/reconcile') {
          return json({ state: 'idle', lastRun: new Date().toISOString() });
        }
        if (pathname === '/api/seerr') {
          return json({ initialized: true, linked: true });
        }
        if (pathname === '/api/seerr/setup') {
          return json({ ok: true });
        }

        // Default fallback for any other API route
        return json({ ok: true });
      });
    },
  };
}
