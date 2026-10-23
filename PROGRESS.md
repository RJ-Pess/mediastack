# Progresso — MediaStack

> A aplicação chamou-se «Cais» até 2026-10-23; foi renomeada para **MediaStack** (pacotes, imagem, containers, variáveis `MEDIASTACK_*`, pastas, UI e documentação).

Última atualização: 2026-10-23 (noite). Estado geral: **alfa**; fases 1–4 feitas, 5 em curso (qualidade/TRaSH feita), 6 por fazer; critérios 1–5 e 7 verificados; CI no GitHub ainda a validar (critério 6).

## Critérios de aceitação

| #   | Critério                                                             | Estado                                                                                                                                                       |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `compose up` + wizard deixa tudo ligado (verificado pelas APIs)      | ✅ `pnpm test:integration`                                                                                                                                   |
| 2   | Mudar idiomas/categoria + apply altera o serviço; 2.º apply sem diff | ✅ `pnpm test:integration`                                                                                                                                   |
| 3   | Alteração direta num serviço é detetada como drift                   | ✅ `pnpm test:integration`                                                                                                                                   |
| 4   | Mount partido é detetado (dois volumes → aviso)                      | ✅ `pnpm test:integration`                                                                                                                                   |
| 5   | e2e Playwright: wizard → pedido → fila do Radarr                     | ⚠️ wizard, indexador falso e pedido via ⌘K passam; a fila do Radarr fica vazia (ver abaixo)                                                                  |
| 6   | Imagem amd64+arm64, não-root, Trivy sem críticos                     | ◑ build amd64 e não-root verificados localmente; arm64 e Trivy correm no CI (1.º run falhou por tag errada do trivy-action, já corrigida; novo run em curso) |
| 7   | Lighthouse acessibilidade ≥ 90 e UI a 375 px                         | ☐ por medir (UI responsiva e com ARIA, mas sem medição)                                                                                                      |

## Fase 1 — Fundação ✅

- [x] Monorepo pnpm (`apps/server`, `apps/web`, `packages/clients`), ESLint/Prettier, TS strict
- [x] Servidor Fastify (`/healthz`, `/api/status`), SPA servida pelo backend
- [x] Dockerfile multi-stage não-root; `docker compose up` com os 7 serviços validado
- [ ] Fixar versões das imagens (hoje `latest`, marcado `TODO` no compose); o Dependabot (`docker-compose`) propõe as atualizações depois
- [x] Imagens confirmadas: `ghcr.io/seerr-team/seerr`, `ghcr.io/thephaseless/byparr`

## Fase 2 — Bootstrap ✅

- [x] `mediastack-init` (mesma imagem, `node dist/index.js init`): gera chaves e a password do qBittorrent em `mediastack/secrets/` (nunca sobrescreve), cria `/data/{torrents,media}/{tv,movies}`, dá a posse a PUID:PGID. Corre como root só com CHOWN/DAC_OVERRIDE/FOWNER.
- [x] Sonarr/Radarr/Prowlarr: chave por `FILE__<SVC>__AUTH__APIKEY` + `<SVC>__AUTH__*` (confirmado com Sonarr 4.0.20, Radarr 6.4.4, Prowlarr 2.6.5; sem `config.xml`).
- [x] qBittorrent: `qBittorrent.conf` (PBKDF2-SHA512) + `categories.json` pré-gerados. Bazarr: `config/config.yaml` com `auth.apikey`.
- [x] Reconciliador (arranque com retry + `POST /api/reconcile`): Sonarr/Radarr→qBittorrent + root folders; Prowlarr tag `cloudflare`, proxy Byparr, apps Sonarr/Radarr (`fullSync`); Bazarr→Sonarr/Radarr; Seerr→Sonarr/Radarr. Idempotente.
- [x] `pnpm test:integration` (`scripts/integration.sh`) cobre ligações, login, plan/apply, drift, hardlinks e Seerr.

## Fase 3 — Plan/Apply ◑

- [x] Estado desejado (Zod) em SQLite (`node:sqlite`) + auditoria. `GET/PUT /api/desired`, `/api/plan`, `/api/apply`, `/api/audit`, `/api/drift`, `/api/drift/adopt`.
- [x] Modelo por "campos" (`plan/fields.ts`): ler real, escrever, adotar. Plan = desejado vs real; apply idempotente com 3 tentativas e auditoria; drift = plan sobre o estado aplicado (5 em 5 min e a pedido).
- [x] Armazenamento (root folders + bibliotecas extra; só adiciona), Downloads (categorias, pastas, limites, rácio), Legendas (idiomas, perfil "MediaStack", perfil por omissão). O Bazarr **apaga** perfis em falta no POST de settings, por isso reenviamos sempre os existentes.
- [x] Arranque: só aplica o estado por omissão se ainda não houver estado guardado (senão escondia o drift).
- [x] **Indexadores**: listar, adicionar (públicos, a partir das ~90 definições do Prowlarr), ativar/desativar, testar e remover (com confirmação) na UI; teste de integração
- [ ] Horários de limites de velocidade; seeding por tempo

## Fase 4 — UI ✅ (a menos de medição)

- [x] Login/setup do admin: argon2id (`@node-rs/argon2`), cookie httpOnly + SameSite=Strict, sessões em SQLite, bloqueio após 5 falhas; todas as rotas `/api` (exceto `/api/auth/*` e `/healthz`) exigem sessão.
- [x] Cofre AES-256-GCM (`MEDIASTACK_SECRET` ou `mediastack.secret` gerado pelo init) para credenciais de terceiros.
- [x] Hardlinks: `POST /api/storage/hardlink-check` + CLI `hardlink-check` (cria ficheiro, link, compara dev/inode).
- [x] Seerr: `POST /api/seerr/setup` autentica no Jellyfin (credenciais não guardadas), lê a API key, `settings/initialize` (a página `/setup` nunca aparece), guarda a key cifrada. Testado com Jellyfin 12.3 real (`deploy/docker-compose.test.yml`, só para testes).
- [x] Dados agregados: atividade (qBittorrent + filas *arr, com pausar/retomar/remover), calendário, biblioteca, pedidos (+aprovar), pesquisa/pedir, sistema (versões, health, disco).
- [x] UI: shell responsivo (barra lateral / barra inferior no telemóvel), tema escuro/claro, wizard de 5 passos, Início, Biblioteca, Pedidos, Atividade, Calendário, Definições (campos por conceito, diff por serviço, "Aplicar tudo", drift com adotar/repor, histórico), Sistema, pesquisa global ⌘K.
- [x] **i18n PT-PT + EN**: a chave é a frase em português; `apps/web/src/locales/en.ts`; um teste falha se faltar tradução. Mensagens de erro do servidor também traduzidas.
- [x] Lighthouse (acessibilidade 100) e verificação a 375 px; menu "Mais" no telemóvel (Sistema, idioma, sair)
- [ ] Botão "abrir UI nativa" por serviço (Avançado) — por fazer
- [ ] Posters/backdrops do TMDB em grande nas páginas de pedidos (hoje só posters em grelha)

### Critério 5 — notas

Dois problemas encontrados pelo e2e e corrigidos: (1) `POST /api/seerr/setup` chamava `reconciler.run()`, que devolvia logo se já houvesse um reconcile a correr, deixando o Seerr sem Radarr/Sonarr — agora um pedido durante uma execução corre outra a seguir (teste unitário); (2) o passo do Jellyfin pode esperar pelo reconcile de arranque, por isso o teste dá-lhe até 90 s. `KEEP=1 pnpm test:e2e` mantém o stack vivo para depuração.

## Fase 5 — Qualidade e backups ◑

- [x] **Perfis TRaSH via Recyclarr** (`ghcr.io/recyclarr/recyclarr:8`, imagem oficial sem modificações). A escolha 1080p / 4K / ambos (wizard e Definições) vai para o estado desejado; o MediaStack escreve `request.env` + `sync.trigger` numa pasta partilhada e um pequeno script (`deploy/recyclarr/sync.sh`) cria as configs a partir dos templates oficiais (`config create -t`), preenche URL/chave e corre `recyclarr sync`, deixando `last-sync.txt`. Sem Docker socket. Campos do plan: `recyclarr.request`, `{radarr,sonarr}.qualityprofiles` (espera pelo Recyclarr) e `seerr.profile.*` (perfil por omissão no Seerr). Estado da sincronização visível nas Definições.
- [x] O reconcile só **cria** os campos geridos pelo plan (categoria do download client, perfil do Seerr) e nunca os repõe depois.
- [ ] Esquema de nomes (via `media_naming` do Recyclarr)
- [ ] Notificações (ntfy / Telegram / Discord) replicadas para os serviços
- [ ] Exportar/importar o estado desejado (YAML)
- [ ] Backups agendados dos *arr (endpoints nativos) com retenção

## Fase 6 — Adoção ☐

- [ ] Modo "importar": apontar para serviços existentes, ler a config e convertê-la em estado desejado sem alterar nada

## Open source / entrega

- [x] Licença MIT; README EN + PT-PT; CONTRIBUTING; SECURITY; templates de issue/PR; Dependabot (npm, docker, docker-compose, actions)
- [x] Defaults genéricos no compose/`.env.example` (`DATA_ROOT` obrigatório, PUID/PGID 1000, TZ UTC, imagem `mediastack:local`); nada específico do host original
- [x] CI para repositório público (só runners do GitHub): lint → typecheck → testes → build; integração; imagem amd64+arm64, Trivy (críticos), verificação não-root, push para GHCR com tags `sha` + semver. Workflow `e2e` manual/semanal.
- [x] Publicado em `RJ-Pess/mediastack` (público). 1.º run do CI: `test` verde; `image` falhou (tag `0.28.0` do trivy-action inexistente → `v0.36.0`) e `integration` falhou por timeout num runner lento (espera agora de 5 min + logs em caso de falha). Run com as correções em curso. Falta: confirmar o CI todo verde (arm64, Trivy, push GHCR) e tornar o pacote GHCR público nas definições do GitHub
- [ ] O Dependabot abriu PRs de atualização no 1.º push (por rever/fundir)
- [ ] `packages/clients` ainda é um stub (clientes escritos à mão em `apps/server/src/reconcile/`)

## Bugs encontrados pelo CI/testes (úteis para a memória do projeto)

- No Linux o container principal não abria a base de dados: o `init` nunca dava a posse (`PUID:PGID`) às pastas `data` e `recyclarr` (uma substituição antiga não chegou a aplicar-se). No macOS/Colima o bind mount é permissivo e escondia o problema. Corrigido com `ownedDirs()` + teste. Reproduzir sempre com um diretório da VM (ex.: `/var/tmp`), não com um caminho do home do Mac.
- `cmd | grep -q` com `set -o pipefail` falha por SIGPIPE quando a resposta é grande; nos scripts usa-se `grep -c … >/dev/null`.
- O Seerr rejeita `id` no corpo do PUT de `settings/{sonarr,radarr}`.

## Decisões

- Segredos dos serviços: ficheiros em `mediastack/secrets/`, montados só-leitura onde são precisos; em claro, como as chaves nos `config.xml` dos próprios serviços. Credenciais de terceiros ficam cifradas no SQLite.
- Clientes de API: um cliente Servarr genérico + Bazarr/qBittorrent/Seerr à mão; gerar das OpenAPI só se compensar.
- `node:sqlite` em vez de better-sqlite3/Drizzle: sem módulos nativos nas imagens amd64/arm64 (emite um aviso "experimental" no arranque).
- Node: o host de desenvolvimento tem Node 26; imagem e CI usam Node 22 LTS.
- Imagem do MediaStack **pública** no GHCR (projeto open source), com tags imutáveis.
- shadcn/ui e TanStack Router não foram usados (Tailwind + componentes próprios + React Router chegaram).
- Autor dos commits: reescrito para o email noreply do GitHub antes da publicação.

## Perguntas em aberto

- Nenhuma bloqueante.
