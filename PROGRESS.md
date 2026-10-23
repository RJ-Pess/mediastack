# Progresso — Cais

## Fase 1 — Fundação (em curso)

- [x] Monorepo pnpm (`apps/server`, `apps/web`, `packages/clients`), ESLint/Prettier, TS strict
- [x] Servidor Fastify: `/healthz`, `/api/status` (sondagem dos 7 serviços), serve a SPA
- [x] SPA React+Vite+Tailwind com cartões de estado
- [x] Dockerfile multi-stage não-root; compose; `.env.example`; CI (lint→testes→build→GHCR)
- [ ] Validar `docker build` e `docker compose up` (daemon Docker parado: Colima não está a correr)
- [ ] Fixar versões das imagens (hoje `latest`, marcado TODO) e configurar Renovate
- [ ] Confirmar nome/tag da imagem do Byparr e do Seerr (`ghcr.io/seerr-team/seerr`)

## Decisões

- Node: o host tem Node 26; a imagem e o CI usam Node 22 LTS.
- shadcn/ui, SQLite/Drizzle, TanStack Router entram na Fase 3/4 (ainda sem necessidade).
- Recyclarr (TRaSH): preferido, conforme pedido; entra na Fase 5.

## Perguntas em aberto

- Dono/nome do repositório GHCR (placeholder `OWNER`).
