# Contributing / Contribuir

Thanks for helping! / Obrigado por ajudares!

## Setup

```bash
npx pnpm@10 install       # Node 22+
pnpm lint && pnpm typecheck && pnpm test
```

Integration and e2e tests need Docker: `pnpm test:integration`, `pnpm test:e2e` (see the README).

## Guidelines

- Cais is a **control plane**. Don't reimplement what the upstream services already do, and don't patch or fork their images.
- New settings are modelled as **fields** (`apps/server/src/plan/fields.ts`): read the real value, write it, adopt it. The plan, apply and drift detection then come for free. Writes must be **idempotent** and must never delete resources Cais didn't create.
- Never store secrets in plain text, in logs, in fixtures or in tests. Never add real indexers, private trackers or credentials to tests – use `tests/mock-indexer`.
- UI strings go through `t('…')` (the key is the Portuguese phrase) and need an entry in `apps/web/src/locales/en.ts`; a test fails if one is missing. Server error messages shown to users should also have an EN entry.
- Keep PRs small and focused; add or update tests; run lint, typecheck and tests before opening a PR.

## Commit messages

Short imperative subject (≤ 72 chars), body explaining _why_ when it isn't obvious.

## Licence

By contributing you agree your work is released under the [MIT licence](LICENSE).
