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

## Fase 3 — Plan/Apply (em curso)

- [x] Estado desejado (Zod) em SQLite (`node:sqlite`, sem módulos nativos) + tabela de auditoria. Endpoints: `GET/PUT /api/desired`, `GET /api/plan`, `POST /api/apply`, `GET /api/audit`, `GET /api/drift`, `POST /api/drift/adopt`.
- [x] Modelo por "campos" (`plan/fields.ts`): cada campo sabe ler o real, escrever e adotar. Plan = desejado vs real; apply = escrever só o que difere (idempotente, 3 tentativas, auditoria por escrita); drift = plan sobre o estado já aplicado (verificação de 5 em 5 min e a pedido).
- [x] Armazenamento: root folders Sonarr/Radarr (+ bibliotecas extra; só adiciona, nunca remove).
- [x] Downloads: categoria nos download clients, pasta das categorias, limites de velocidade e rácio de seeding no qBittorrent.
- [x] Legendas: idiomas ativos + perfil "Cais" + perfil por omissão no Bazarr. O Bazarr **apaga** os perfis que faltem no POST de settings, por isso reenviamos sempre os existentes; idiomas só são ativados, nunca desativados.
- [x] Arranque: só aplica o estado por omissão se ainda não houver estado guardado (senão esconderia o drift).
- [x] Integração (`pnpm test:integration`) cobre critérios 2 e 3: mudar categoria/limite/idiomas → valor real muda; 2.º plan vazio; alteração direta no qBittorrent → drift; adotar resolve.
- [ ] Indexadores (listar/ativar/testar no Prowlarr) — por fazer.
- [ ] Horários de limites de velocidade e seeding por tempo — por fazer.
- [x] Autenticação do Cais (feita na Fase 4): argon2id (`@node-rs/argon2`), cookie httpOnly + SameSite=Strict, sessões em SQLite (hash SHA-256 do token), bloqueio após 5 falhas, todas as rotas `/api` (exceto `/api/auth/*`) exigem sessão.

## Fase 4 — UI completa (em curso)

- [x] Login/setup do admin (`/api/auth/{setup,login,logout,me}`); `cais.secret` gerado pelo init; cofre AES-256-GCM (`crypto.ts`) para credenciais de terceiros.
- [x] Verificação de hardlinks (`POST /api/storage/hardlink-check`, CLI `hardlink-check`): cria ficheiro, faz link, compara dev/inode. Critério 4 coberto no teste de integração (dois volumes → `different_mounts`).
- [ ] Seerr (precisa Jellyfin; plano: Jellyfin real no teste, completar o setup via `/auth/jellyfin` + `/settings/initialize`).
- [ ] Wizard, painel, atividade, calendário, biblioteca, pedidos, ⌘K, design final.

## Decisões

- Segredos: ficheiros em `cais/secrets/` (montado só-leitura nos serviços que precisam). Estão em claro, como as chaves nos config.xml dos próprios serviços; a cifra com `CAIS_SECRET` aplica-se ao estado desejado/credenciais de terceiros na Fase 3.
- Clientes API: por agora um cliente Servarr genérico escrito à mão (`reconcile/arr.ts`); a geração a partir das OpenAPI fica para quando houver tipos que justifiquem.
- Node: o host tem Node 26; a imagem e o CI usam Node 22 LTS.
- shadcn/ui, SQLite/Drizzle, TanStack Router entram na Fase 3/4 (ainda sem necessidade).
- Recyclarr (TRaSH): preferido, conforme pedido; entra na Fase 5.

## Perguntas em aberto

- Dono/nome do repositório GHCR (placeholder `OWNER`).
