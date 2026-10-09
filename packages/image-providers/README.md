# Image providers

Shared, framework-independent image catalog, validation and native protocol execution for xopc and xopc-platform. Keep credentials, SSRF policy, storage, billing and UI in the host application. Inject a guarded fetch and an operation-wide AbortSignal; the module does not submit retries.

The workspace package is private and bundled into xopc. `scripts/sync-image-providers.mjs` produces the independently buildable platform snapshot and SHA-256 provenance manifest. Update both repositories together; no legacy model aliases or capability projections are supported.

Run the root Vitest packages project for contract tests. Use the root synchronization script to build TypeScript and replace the platform snapshot. Model IDs and limits are maintained in `src/catalog.ts`; current, model-specific protocol mapping lives in `src/execute.ts`.
