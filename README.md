# Cais

[Português](README.pt-PT.md) · **English**

**One panel for your self-hosted media stack.** Cais is a control plane for [Seerr](https://github.com/seerr-team/seerr), [Sonarr](https://sonarr.tv), [Radarr](https://radarr.video), [Bazarr](https://www.bazarr.media), [Prowlarr](https://prowlarr.com), [Byparr](https://github.com/ThePhaseless/Byparr) and [qBittorrent](https://www.qbittorrent.org). It runs the **official, unmodified images** side by side in one Docker Compose stack, wires them together automatically and lets you manage their settings in one place through their official APIs.

> **Status: alpha.** The core (bootstrap, wiring, plan/apply, drift detection, UI) works and is covered by integration and end-to-end tests, but several planned features are not done yet — see [Roadmap](#roadmap). Expect breaking changes.

## What it does

- **Zero-touch bootstrap** – generates API keys and credentials on first start and injects them into the services _before_ they boot. No `/setup` pages to click through.
- **Automatic wiring** – Prowlarr ↔ Sonarr/Radarr, Prowlarr → Byparr (Cloudflare proxy), Sonarr/Radarr → qBittorrent (categories + root folders), Bazarr → Sonarr/Radarr, Seerr → Jellyfin + Sonarr/Radarr.
- **Settings by concept, not by service** – storage, downloads, subtitles… each field shows which services it affects.
- **Plan → diff → apply** (Terraform-style) – see exactly what will change in each service, apply idempotently, with an audit log.
- **Drift detection** – notices when someone changes a setting directly in a service's own UI; adopt the change or restore the desired value.
- **Never deletes what it didn't create.**
- **Hardlink check** – the wizard really creates a file, hardlinks it and compares inodes, so a broken mount is caught before it silently doubles your disk usage.
- **Unified UI** – activity queue, calendar, library, requests (with quick approval), global search (⌘K), responsive, dark/light, PT-PT and English.

Cais does **not** reimplement any of these services. Downloading, importing, subtitles and indexing stay in the upstream projects.

## Requirements

- Docker with Compose v2 (amd64 or arm64)
- A single filesystem for downloads and libraries (needed for hardlinks / atomic moves)
- An existing **Jellyfin** server (Cais connects Seerr to it; it is not part of the stack)

## Quick start

```bash
git clone https://github.com/<owner>/cais.git && cd cais
docker build -t cais:local .            # or set CAIS_IMAGE to a published tag

cd deploy
cp .env.example .env                     # then edit it (at least DATA_ROOT and PUID/PGID)
docker compose up -d
```

Open `http://<host>:8088` and follow the wizard (admin account → storage + hardlink test → subtitle languages → Jellyfin → apply).

Your data root is mounted at `/data` in every container that touches media:

```
/data/torrents/{movies,tv}
/data/media/{movies,tv}
```

Only Cais (`CAIS_PORT`) and the torrent port (`TORRENT_PORT`) are published on the host; everything else stays on the internal Compose network. Cais is designed for a trusted LAN or VPN – **do not expose it to the Internet** without a reverse proxy providing TLS.

### CasaOS

`deploy/docker-compose.yml` includes an `x-casaos` block, so you can import it as a custom app. Typical values: `DATA_ROOT=/DATA/Media`, `CONFIG_ROOT=/DATA/AppData/cais`.

### Ports already in use?

If another *arr stack is running on the same host, nothing conflicts by default: only `CAIS_PORT` and `TORRENT_PORT` are published, and both are configurable.

## Security model

- Login is mandatory (argon2id, `httpOnly` + `SameSite=Strict` session cookie, lockout after repeated failures).
- Third-party secrets are encrypted at rest with AES-256-GCM using a key derived from `CAIS_SECRET` (or a secret generated on first start).
- Service API keys live as files in `config/cais/secrets/` and are mounted read-only into the services that need them – the same trust level as the `config.xml` files the services already keep.
- The Docker socket is **never** mounted. The Cais container is non-root, `no-new-privileges`, `cap_drop: ALL`. The short-lived `cais-init` container runs as root with only `CHOWN`, `DAC_OVERRIDE` and `FOWNER`.
- No telemetry. The only outbound connections are TMDB image/metadata lookups and whatever the services themselves do.

Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Updating

Pin image versions in `deploy/docker-compose.yml` (Dependabot is configured to propose bumps), then:

```bash
docker compose pull && docker compose up -d
```

## Backup and restore

Back up the whole `CONFIG_ROOT` directory (services' configs, Cais database and secrets) while the stack is stopped (`docker compose stop`), and restore it by copying it back. Built-in scheduled backups are on the roadmap.

## Troubleshooting

| Symptom                                  | Likely cause                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `DATA_ROOT` error on `docker compose up` | Set `DATA_ROOT` in `deploy/.env`.                                                                       |
| Wizard warns about hardlinks             | Downloads and libraries are on different mounts/filesystems. Use one volume for `DATA_ROOT`.            |
| A service is red on the dashboard        | `docker compose logs <service>`; Cais retries wiring on start and via **Settings → Apply**.             |
| Permission errors in `/data`             | `PUID`/`PGID` must own `DATA_ROOT` (`id` on the host shows yours).                                      |
| Seerr is not connected                   | Finish the Jellyfin step of the wizard (Seerr only completes setup by authenticating against Jellyfin). |

## Development

```bash
npx pnpm@10 install          # Node 22+
pnpm dev:server              # API on :8080
pnpm dev:web                 # Vite dev server (proxies /api)
pnpm lint && pnpm typecheck && pnpm test
pnpm test:integration        # real stack in Docker: wiring, plan/apply, drift, hardlinks, Seerr
pnpm test:e2e                # Playwright: wizard → request a movie → shows up in Radarr's queue
```

The integration and e2e tests use the official images, a real empty Jellyfin and a **mock Torznab indexer** (`tests/mock-indexer`) that serves a fake torrent with no content, no tracker and no peers. They never download real content.

Repository layout: `apps/server` (Fastify API, bootstrap, reconciler), `apps/web` (React UI), `packages/clients` (reserved for generated API clients), `deploy` (Compose), `tests`, `e2e`, `scripts`.

## Roadmap

- [x] Bootstrap and automatic wiring
- [x] Plan/apply, audit log, drift detection (storage, downloads, subtitles)
- [x] Wizard, dashboard, activity, calendar, library, requests, ⌘K search, PT/EN UI
- [ ] Indexer management (list/enable/test) in the UI
- [ ] Quality profiles via [Recyclarr](https://recyclarr.dev) / TRaSH Guides, naming schemes
- [ ] Notifications (ntfy / Telegram / Discord) replicated to all services
- [ ] Config export/import and scheduled backups
- [ ] Adopt an existing installation (import mode)
- [ ] Download schedules, seeding by time
- [ ] Multi-arch image published to GHCR with Trivy scan in CI

## Contributing

Issues and pull requests are welcome – see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). Cais is not affiliated with Sonarr, Radarr, Bazarr, Prowlarr, Seerr, Byparr, qBittorrent or Jellyfin; those names belong to their respective projects.
