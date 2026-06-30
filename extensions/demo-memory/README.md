# Demo Memory Provider Extension

Minimal extension-backed memory provider.

It is intentionally in-memory:

- no SQLite writes
- no `MEMORY.md` / `USER.md` writes
- no network calls

## What It Proves

- `xopc.extension.json` can declare `contracts.memoryProviders`.
- `discoverMemoryPlugins()` can discover memory providers from installed extensions.
- `loadMemoryPluginProviders()` can construct a provider from the extension `main` module.
- `MemoryManager.initializeAll()` loads extension providers once.
- `MemoryManager.write()` can route writes to an external provider when write policy allows it.
- `MemoryManager.search()` returns provider citations.
- `MemoryManager.recordSignal()` can sync signal content into provider memory.

## Try It

```bash
pnpm vitest run src/agent/memory/__tests__/memory-plugin-discovery.test.ts
```

Real providers should replace the in-memory `Map` with their backend and implement `update` /
`delete` when supported.
