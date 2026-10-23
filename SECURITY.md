# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private
[security advisory](../../security/advisories/new) form for this repository.
Include steps to reproduce and the affected version. You can expect an acknowledgement within a few days.

## Scope and assumptions

MediaStack is meant to run on a trusted LAN or behind a VPN. It is not hardened for direct Internet exposure; if you
must expose it, put it behind a TLS-terminating reverse proxy.

In scope: authentication/session handling, secret storage, the init/bootstrap flow, and the API.
Out of scope: vulnerabilities in the upstream services (Sonarr, Radarr, …) – report those to their projects.

---

# Política de segurança (PT-PT)

Não abras uma issue pública para problemas de segurança: usa o formulário privado de
[security advisory](../../security/advisories/new) do repositório, com passos para reproduzir e a versão afetada.
O MediaStack destina-se a uma LAN ou VPN de confiança; para exposição à Internet usa um reverse proxy com TLS.
