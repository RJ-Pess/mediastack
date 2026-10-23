import { z } from 'zod';

const absPath = z.string().regex(/^\/[^\0]*$/, 'caminho absoluto');

/** Estado desejado único, editado na UI e aplicado a vários serviços. */
export const desiredSchema = z.object({
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
