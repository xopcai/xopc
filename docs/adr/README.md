# Architecture Decision Records (ADRs)

Short notes on architecture decisions worth remembering — the *why*, the alternatives we considered, and
the invariants we left behind so the next person doesn't undo them by accident.

## Format

Each ADR has a header (status / date / scope), a context section (what was the problem), the decision
(what we did), and consequences (what that bought us and what it cost).

Status values: `Proposed`, `Accepted`, `Deprecated`, `Superseded by NNNN`.

## Index

| # | Title | Status |
|---|---|---|
| [0001](./0001-agent-service-decomposition.md) | AgentService god-class decomposition | Accepted |

## When to write one

Write an ADR when you make a decision that:

- Splits or merges a long-running concept (god class, monolith, shared singleton);
- Locks in a boundary that future PRs should not silently cross
  (e.g. a new `dependency-cruiser` rule);
- Picks between two reasonable patterns where the next reader will wonder why we went one way
  (e.g. interface narrowing vs DI container, public field vs delegation method);
- Trades off an unfixable thing (vendor lock-in, public API compat) so it's documented before someone
  tries to "clean it up" later.

Skip ADRs for *implementation* decisions inside a single file — those belong in code comments.

## See also

- [docs/architecture.md](../architecture.md) — current architecture overview.
- `.dependency-cruiser.cjs` — the actual architecture invariants in code.
- `pnpm run depcheck` — runs them locally; the same command runs in CI (`.github/workflows/ci.yml`).
