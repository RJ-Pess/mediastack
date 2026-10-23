# MediaStack

**Português** · [English](README.md)

**Um painel único para a tua stack de media self-hosted.** O MediaStack é um plano de controlo para [Seerr](https://github.com/seerr-team/seerr), [Sonarr](https://sonarr.tv), [Radarr](https://radarr.video), [Bazarr](https://www.bazarr.media), [Prowlarr](https://prowlarr.com), [Byparr](https://github.com/ThePhaseless/Byparr) e [qBittorrent](https://www.qbittorrent.org). Corre as **imagens oficiais, sem modificações**, lado a lado num único Docker Compose, liga-as automaticamente e deixa-te gerir as definições num só sítio, pelas APIs oficiais de cada serviço.

> **Estado: alfa.** O núcleo (bootstrap, ligações, plan/apply, deteção de drift, UI) funciona e tem testes de integração e e2e, mas há funcionalidades planeadas por fazer — ver [Roteiro](#roteiro). Podem existir alterações incompatíveis.

## O que faz

- **Bootstrap sem intervenção** – gera API keys e credenciais no primeiro arranque e injeta-as nos serviços _antes_ de arrancarem. Sem páginas `/setup` para preencher.
- **Ligações automáticas** – Prowlarr ↔ Sonarr/Radarr, Prowlarr → Byparr (proxy Cloudflare), Sonarr/Radarr → qBittorrent (categorias + root folders), Bazarr → Sonarr/Radarr, Seerr → Jellyfin + Sonarr/Radarr.
- **Definições por conceito, não por serviço** – armazenamento, downloads, legendas… cada campo mostra que serviços afeta.
- **Plan → diff → apply** (ao estilo Terraform) – vês exatamente o que muda em cada serviço, aplicas de forma idempotente, com registo de auditoria.
- **Deteção de drift** – avisa quando alguém altera algo diretamente na UI de um serviço; podes adotar a alteração ou repor o valor desejado.
- **Nunca apaga o que não criou.**
- **Verificação de hardlinks** – o wizard cria mesmo um ficheiro, faz o hardlink e compara inodes; um mount partido é detetado antes de duplicar o uso de disco em silêncio.
- **Qualidade e nomes dos TRaSH Guides** – escolhes 1080p / 4K / ambos e um esquema de nomes (Jellyfin, Plex, Emby); o container oficial do Recyclarr aplica-os. Sem socket do Docker.
- **Modo importar** – já tens Sonarr/Radarr/… a correr? Aponta o MediaStack para eles (URL + API key), revê o que ele percebeu e aceita; nada muda nos teus serviços até aplicares.
- **UI unificada** – fila de atividade, calendário, biblioteca, pedidos (com aprovação rápida), pesquisa global (⌘K), responsiva, tema escuro/claro, PT-PT e inglês.

O MediaStack **não** reimplementa nenhum destes serviços. Downloads, importação, legendas e indexação ficam nos projetos originais.

## Requisitos

- Docker com Compose v2 (amd64 ou arm64)
- Um único sistema de ficheiros para downloads e bibliotecas (necessário para hardlinks / moves atómicos)
- Um servidor **Jellyfin** já existente (o MediaStack liga o Seerr a ele; não faz parte da stack)

## Início rápido

```bash
git clone https://github.com/<owner>/mediastack.git && cd mediastack
docker build -t mediastack:local .            # ou define MEDIASTACK_IMAGE com uma tag publicada

cd deploy
cp .env.example .env                     # edita (pelo menos DATA_ROOT e PUID/PGID)
docker compose up -d
```

Abre `http://<host>:8088` e segue o wizard (conta de admin → armazenamento + teste de hardlinks → idiomas das legendas → Jellyfin → aplicar).

A raiz de dados é montada em `/data` em todos os containers que tocam em media:

```
/data/torrents/{movies,tv}
/data/media/{movies,tv}
```

Só o MediaStack (`MEDIASTACK_PORT`) e a porta de torrents (`TORRENT_PORT`) são publicados no host; o resto fica na rede interna do Compose. O MediaStack foi pensado para uma LAN ou VPN de confiança – **não o exponhas à Internet** sem um reverse proxy com TLS.

### CasaOS

O `deploy/docker-compose.yml` inclui um bloco `x-casaos`, por isso pode ser importado como app personalizada. Valores típicos: `DATA_ROOT=/DATA/Media`, `CONFIG_ROOT=/DATA/AppData/mediastack`.

### Já tens portas ocupadas?

Se já existir outra stack *arr no mesmo host não há conflitos por defeito: só `MEDIASTACK_PORT` e `TORRENT_PORT` são publicadas, e ambas são configuráveis.

## Modelo de segurança

- Login obrigatório (argon2id, cookie de sessão `httpOnly` + `SameSite=Strict`, bloqueio após falhas repetidas).
- Segredos de terceiros cifrados em repouso com AES-256-GCM, com chave derivada de `MEDIASTACK_SECRET` (ou de um segredo gerado no primeiro arranque).
- As API keys dos serviços ficam em ficheiros em `config/mediastack/secrets/`, montados só-leitura nos serviços que precisam – o mesmo nível de confiança dos `config.xml` que os serviços já guardam.
- O Sonarr, Radarr e Prowlarr correm com autenticação `External` (a API continua a exigir a chave gerada). As portas deles **não são publicadas**, por isso só o MediaStack lhes chega; se publicares uma porta para abrir uma UI nativa, protege-a com o teu reverse proxy ou ativa a autenticação no compose.
- O socket do Docker **nunca** é montado. O container do MediaStack é não-root, `no-new-privileges`, `cap_drop: ALL`. O `mediastack-init` (efémero) corre como root só com `CHOWN`, `DAC_OVERRIDE` e `FOWNER`.
- Sem telemetria. As únicas ligações externas são consultas ao TMDB e o que os próprios serviços fazem.

Vulnerabilidades: ver [SECURITY.md](SECURITY.md).

## Atualização

Fixa as versões das imagens em `deploy/docker-compose.yml` (o Dependabot está configurado para propor atualizações) e depois:

```bash
docker compose pull && docker compose up -d
```

## Backup e restauro

Faz backup de todo o `CONFIG_ROOT` (configs dos serviços, base de dados e segredos do MediaStack) com a stack parada (`docker compose stop`) e restaura copiando de volta. Backups agendados integrados estão no roteiro.

## Resolução de problemas

| Sintoma                                     | Causa provável                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Erro por `DATA_ROOT` no `docker compose up` | Define `DATA_ROOT` em `deploy/.env`.                                                                                |
| O wizard avisa sobre hardlinks              | Downloads e bibliotecas estão em mounts/sistemas de ficheiros diferentes. Usa um único volume para `DATA_ROOT`.     |
| Um serviço está vermelho no painel          | `docker compose logs <serviço>`; o MediaStack volta a tentar as ligações no arranque e em **Definições → Aplicar**. |
| Erros de permissões em `/data`              | `PUID`/`PGID` têm de ser donos de `DATA_ROOT` (`id` no host mostra os teus).                                        |
| O Seerr não está ligado                     | Conclui o passo do Jellyfin no wizard (o Seerr só termina o setup autenticando-se no Jellyfin).                     |

## Desenvolvimento

```bash
npx pnpm@10 install          # Node 22+
pnpm dev:server              # API em :8080
pnpm dev:web                 # servidor Vite (proxy de /api)
pnpm lint && pnpm typecheck && pnpm test
pnpm test:integration        # stack real em Docker: ligações, plan/apply, drift, hardlinks, Seerr
pnpm test:e2e                # Playwright: wizard → pedir um filme → aparece na fila do Radarr
```

Os testes de integração e e2e usam as imagens oficiais, um Jellyfin real vazio e um **indexador Torznab falso** (`tests/mock-indexer`) que serve um torrent de brincadeira sem conteúdo, tracker nem peers. Nunca descarregam conteúdo real.

Estrutura: `apps/server` (API Fastify, bootstrap, reconciliador), `apps/web` (UI React), `deploy` (Compose), `tests`, `e2e`, `scripts`.

## Roteiro

- [x] Bootstrap e ligações automáticas
- [x] Plan/apply, auditoria, deteção de drift (armazenamento, downloads, legendas, qualidade, nomes, backups, notificações)
- [x] Wizard, painel, atividade, calendário, biblioteca, pedidos, pesquisa ⌘K, UI PT/EN
- [x] Gestão de indexadores (listar / adicionar públicos / ativar / testar / remover)
- [x] Perfis de qualidade e nomes de ficheiros via [Recyclarr](https://recyclarr.dev) / TRaSH Guides
- [x] Um destino de notificações (ntfy / Discord / Telegram) replicado no Sonarr, Radarr e Prowlarr
- [x] Exportar/importar configuração (YAML) e backups nativos (agenda, retenção, "fazer agora")
- [x] Modo importar: ligar a uma instalação existente, ler as definições, não alterar nada até aplicares
- [ ] Notificações para o Bazarr (Apprise) e o Seerr
- [ ] Indexadores privados (credenciais) na UI
- [ ] Horários de limites de velocidade, seeding por tempo
- [ ] Imagem multi-arch publicada no GHCR com scan Trivy no CI (pipeline pronto, primeira release por fazer)

## Contribuir

Issues e pull requests são bem-vindos – ver [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

[MIT](LICENSE). O MediaStack não é afiliado ao Sonarr, Radarr, Bazarr, Prowlarr, Seerr, Byparr, qBittorrent nem Jellyfin; esses nomes pertencem aos respetivos projetos.
