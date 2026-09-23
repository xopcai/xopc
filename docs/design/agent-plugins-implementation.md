# Agent Plugins implementation

Implement Agent Plugins 1.0 as a package format in Extensions. Portable bundles are never imported as native extensions. Reuse Skill discovery, MCP sessions, OAuth and connector secrets.

## Delivery and review log

- [x] P0: Versioned validation, component isolation, paths, package identity and capability review. Focused validation tests passed; review corrected nonfatal unknown manifest field handling.
- [x] P1: Transactional local/archive installation, read-only Skill sources, activation and integrity. 26 focused/regression tests and root typecheck passed. Review added relocation checks and stale-review protection; updates retain the previous revision and persistent data.
- [x] P2: Namespaced MCP contributions, variables/data directories, safe HTTP and runtime refresh. Existing MCP/Skill regressions (42 tests) and two real stdio/HTTP integration tests passed. Review fixed transport-construction fault isolation and deterministic plugin policy names.
- [x] P3: Host-managed credentials, OAuth connection/recovery and component diagnostics. Auth reference/endpoint-change/isolation tests passed with MCP route regressions (43 tests). Review added owner/plugin/server scoping to existing OAuth storage without duplicating the OAuth implementation.
- [x] P4: Gateway/CLI/UI lifecycle, marketplace format dispatch, update review, rollback, removal and the shared connection action bar. Real authenticated Gateway HTTP tests cover lazy routing, install review, activation, updates, rollback, OAuth state/callback rejection and removal. UI tests cover review hashes, invalidation after source changes, explicit authorization and secret-input cleanup.
- [x] P5: Plugin MCP authorization recovery. Discovery and tool-level authorization challenges create a durable connection wait; local or pasted remote callbacks are verified through the existing MCP OAuth manager, then the preserved task resumes. The former tool-result authorization card and synthetic connect tool were removed.

Each phase requires focused tests, review of the actual diff, and fixes before proceeding. Avoid format fallback, duplicated runtimes and speculative abstraction. Keep native extensions operational; remove replaced paths within the affected feature.

## Contract

Source: https://agent-plugins.org/specification (1.0.0). The specification's failure boundaries take precedence over blanket JSON schema rejection. Unknown manifest fields are reported and ignored; invalid required or metadata fields reject the manifest. Invalid MCP servers and Skills are isolated.

Artifacts live in the managed plugins directory, data in plugin-data, and private host receipts outside artifact roots. A receipt points to an immutable revision so installing/updating can atomically switch the active revision. Secrets remain in the existing secret store. No second marketplace or native-module loader.

## Final review fixes

- Isolate transport construction and malformed auth bindings by server; reject reserved plugin identities from the user MCP config, including while a plugin is disabled.
- Validate package trees before hashing/copying: bounded archives, no traversal, escaping links, hardlinks or special files; revalidate after relocation.
- Keep first installs disabled. Require a content-bound review hash for first install and expanded capabilities, reject stale reviews and mismatched update identities.
- Bind API keys and OAuth to the host owner/plugin/server/endpoint; changing an endpoint cannot silently reuse the old binding. Cancel pending OAuth and wait for in-flight exchanges before deleting credentials.
- Persist revision-bound connection health and refresh inventories after tests, authorization, disconnection and lifecycle operations.
- Correct remote CLI inspection, include plugins in default update/verify, respect native package metadata precedence and report the actual installed marketplace package identity.
- Respect the existing Skill loader's per-source limits and refresh Skills after receipt activation changes without installing symlinks.
- Delete the unused `/api/mcp/approvals/respond` success-only stub and its reference. No deprecated-format fallback or parallel credential/runtime stack was added.

## Verification and boundaries

The final focused regression passed **203 tests across 36 files**, covering `src/extensions/agent-plugins/__tests__`, `src/agent/mcp/__tests__`, `src/agent/skills/__tests__`, external-tool provider tests, the real Gateway HTTP integration, lazy-route mappings and the Agent Plugin dialog tests. Root/Web typechecks, changed-file ESLint, Node packaging and the Web production build pass. Web build reports existing large-chunk/dynamic-import warnings.

This delivery supports a single host owner. It does not implement multi-user delegation, publisher signatures or a stdio process sandbox. Store SHA and local integrity checks are not publisher authentication. OAuth protocol/session/error paths were tested with local fixtures and mocks; no user's live provider account was authorized. Services requiring a pre-registered custom OAuth client may need additional integration. Remote callbacks can be submitted through the authenticated UI; automatic replay of interrupted tasks is deliberately not performed.

See [the user guide](../zh/extensions.md#agent-plugin) for supported sources, commands, authorization and retained-data behavior.
