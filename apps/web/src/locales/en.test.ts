import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from './en';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
  });

// Frases passadas a t() por indireção (mapas, constantes) e por isso invisíveis ao scan.
const INDIRECT = [
  'Em ordem',
  'Atenção',
  'Problema',
  'Inativo',
  'Pendente',
  'Aprovado',
  'Recusado',
  'Português (PT)',
  'Inglês',
  'Português (BR)',
  'Espanhol',
  'Francês',
  'Armazenamento',
  'Descobrir',
  'Parecido com a tua biblioteca',
  'a partir dos filmes que adicionaste por último',
  'Em tendência',
  'esta semana',
  'Filmes a estrear',
  'Séries a estrear',
  'nas próximas semanas',
  'Para ti',
  'Explorar',
  'Downloads',
  'Legendas',
];

describe('traduções EN', () => {
  it('todas as frases usadas em t() têm tradução', () => {
    const used = new Set<string>(INDIRECT);
    const re = /\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
    for (const f of walk(join(__dirname, '..'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(re))
        used.add((m[1] ?? m[2])!.replace(/\\'/g, "'"));
    }
    expect([...used].filter((k) => !(k in en)).sort()).toEqual([]);
  });

  it('mantém os mesmos marcadores {x} nas duas línguas', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    const bad = Object.entries(en).filter(
      ([k, v]) => !k.startsWith('field:') && vars(k) !== vars(v),
    );
    expect(bad).toEqual([]);
  });
});
