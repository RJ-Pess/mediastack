import { z } from 'zod';

const absPath = z.string().regex(/^\/[^\0]*$/, 'caminho absoluto');

/** Estado desejado único, editado na UI e aplicado a vários serviços. */
const lang = z.string().regex(/^[a-z]{2,3}$/, 'código de idioma do Bazarr (ex.: pt, en)');

export const desiredSchema = z.object({
  quality: z.object({
    /** Perfis TRaSH aplicados pelo Recyclarr ao Sonarr e Radarr. */
    profile: z.enum(['1080p', '4k', 'both']),
  }),
  subtitles: z.object({
    /** Por ordem de preferência. `pt` = português de Portugal, `pb` = Brasil. */
    languages: z.array(lang).min(1),
  }),
  storage: z.object({
    tvRoot: absPath,
    moviesRoot: absPath,
    /** Bibliotecas extra (ex.: "Filmes Bons"); só são adicionadas, nunca removidas. */
    extraTvRoots: z.array(absPath),
    extraMoviesRoots: z.array(absPath),
  }),
  downloads: z.object({
    torrentsRoot: absPath,
    categories: z.object({ tv: z.string().min(1), movies: z.string().min(1) }),
    /** KiB/s; 0 = sem limite. */
    downKiBps: z.number().int().min(0),
    upKiBps: z.number().int().min(0),
    /** Rácio máximo de seeding; 0 = desligado. */
    seedRatio: z.number().min(0),
  }),
});

export type Desired = z.infer<typeof desiredSchema>;

export const defaultDesired = (): Desired => ({
  quality: { profile: '1080p' },
  subtitles: { languages: ['pt', 'en'] },
  storage: {
    tvRoot: '/data/media/tv',
    moviesRoot: '/data/media/movies',
    extraTvRoots: [],
    extraMoviesRoots: [],
  },
  downloads: {
    torrentsRoot: '/data/torrents',
    categories: { tv: 'tv', movies: 'movies' },
    downKiBps: 0,
    upKiBps: 0,
    seedRatio: 0,
  },
});
