# Progresso — Cais

## Fase 1 — Fundação (em curso)

- [x] Monorepo pnpm (`apps/server`, `apps/web`, `packages/clients`), ESLint/Prettier, TS strict
- [x] Servidor Fastify: `/healthz`, `/api/status` (sondagem dos 7 serviços), serve a SPA
- [x] SPA React+Vite+Tailwind com cartões de estado
- [x] Dockerfile multi-stage não-root; compose; `.env.example`; CI (lint→testes→build→GHCR)
- [x] `docker build` validado (Colima arrancado); contentor corre como `node` (não-root), `/healthz`, `/api/status` e SPA OK
- [ ] Validar `docker compose up` com os 7 serviços
- [ ] Fixar versões das imagens (hoje `latest`, marcado TODO) e configurar Renovate
- [ ] Confirmar nome/tag da imagem do Byparr e do Seerr (`ghcr.io/seerr-team/seerr`)

## Fase 2 — Bootstrap (quase completa)
- [x] `cais-init` (mesma imagem, `node dist/index.js init`): gera chaves (32 hex) e a password do qBittorrent em `cais/secrets/` (nunca sobrescreve), cria `/data/{torrents,media}/{tv,movies}` e dá a posse a PUID:PGID. Corre como root só com CHOWN/DAC_OVERRIDE/FOWNER.
- [x] Sonarr/Radarr/Prowlarr recebem a chave por `FILE__<SVC>__AUTH__APIKEY` (convenção linuxserver) + `<SVC>__AUTH__*`. Verificado com Sonarr 4.0.20, Radarr 6.4.4, Prowlarr 2.6.5: as variáveis de override funcionam, sem config.xml.
- [x] qBittorrent: `qBittorrent.conf` (PBKDF2-SHA512) + `categories.json` pré-gerados; login verificado.
- [x] Bazarr: `config/config.yaml` com `auth.apikey` pré-gerado (Bazarr 1.6.2 aceita).
- [x] Reconciliador (arranque com retry + `POST /api/reconcile`): Sonarr/Radarr→qBittorrent + root folders; Prowlarr tag `cloudflare`, proxy Byparr, apps Sonarr/Radarr (`fullSync`); Bazarr→Sonarr/Radarr. Idempotente.
- [x] `pnpm test:integration` (`scripts/integration.sh`): stack real num ambiente limpo, verifica tudo pelas APIs e que o 2.º reconcile não altera nada. Passa.
- [ ] **Seerr**: o Seerr 3.5.1 só conclui o setup autenticando num media server (`/auth/local` devolve 403 antes disso). Precisa das credenciais do Jellyfin (wizard, Fase 4). Para o teste de integração será preciso um Jellyfin falso ou real. Pendente.
- [ ] Perfil de idiomas do Bazarr (pt-PT + en) — entra com as definições de Legendas (Fase 3).
- [ ] Teste de integração ainda não corre no CI (descarrega ~6 imagens).

## Decisões

- Segredos: ficheiros em `cais/secrets/` (montado só-leitura nos serviços que precisam). Estão em claro, como as chaves nos config.xml dos próprios serviços; a cifra com `CAIS_SECRET` aplica-se ao estado desejado/credenciais de terceiros na Fase 3.
- Clientes API: por agora um cliente Servarr genérico escrito à mão (`reconcile/arr.ts`); a geração a partir das OpenAPI fica para quando houver tipos que justifiquem.
- Node: o host tem Node 26; a imagem e o CI usam Node 22 LTS.
- shadcn/ui, SQLite/Drizzle, TanStack Router entram na Fase 3/4 (ainda sem necessidade).
- Recyclarr (TRaSH): preferido, conforme pedido; entra na Fase 5.

## Perguntas em aberto

- Dono/nome do repositório GHCR (placeholder `OWNER`).
