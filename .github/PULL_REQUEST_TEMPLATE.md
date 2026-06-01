## Summary

<!-- What changed and why (1–3 sentences) -->

## Related issues

<!-- Fixes #123, Closes #456 -->

## Test plan

- [ ] `pnpm test` (or targeted `pnpm vitest run …`)
- [ ] `pnpm run lint` (and `cd web && pnpm run lint` if web changed)
- [ ] `pnpm run depcheck` — architecture invariants (must show **0 errors**; circular warnings are accepted tech debt, see below)
- [ ] Manual verification (describe steps):

## Architecture / dependency-cruiser

`pnpm run depcheck` runs in CI via `.github/workflows/ci.yml` (`architecture` job). It enforces 25+ SOLID
rules in `.dependency-cruiser.cjs` plus the global `no-circular` rule:

- **No lower-level subsystem may import `AgentService`, `AgentManager`, or higher-layer modules.**
- **No circular dependencies** — exactly one cycle is whitelisted (`agent/image/generation/{provider-registry,types}`)
  because it is the public contract surface for five extension packages; everything else must stay acyclic.

If your PR introduces:

- ⚠️ a **new SOLID error** → fix the architecture (usually by injecting a dependency or splitting types out
  to a leaf file); see existing patterns like `AgentInstanceGateway`, `image-provider-contract`, or
  `cli/context.ts`.
- ⚠️ a **new circular dependency** → CI will block. Break the cycle (DI / leaf type module); add to the
  `pathNot` whitelist only with strong justification.

## Notes

<!-- Breaking changes, config/docs updates, screenshots -->
