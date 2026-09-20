# WPS 365 pinned contracts

`bundle.json` was derived from the official specs downloaded by WPS CLI v0.3.6 on 2026-09-20. Original spec SHA-256 digests are recorded in `provenance`. Each bundled asset has its own digest.

The bundle retains only `user.me` and 14 curated read commands, their OpenAPI operations and transitively referenced schemas. JSON is valid YAML and is installed under the official `config/spec/{api,curated}.yaml` override paths. Input schemas were exported with the official binary's `mcp tools --json`; the caller-controlled `token_type` property was removed. Business execution uses CLI commands directly, not an MCP server.

The action contracts, command argument order and provider specs form one reviewed unit. Updating any of them changes action revisions. Do not run `spec update` in managed account contexts. Existing mismatched files fail integrity checks rather than silently changing contracts.

Sources: https://github.com/wps365-open/cli and https://open.wps.cn/documents/wps365-cli . The upstream OpenAPI contains a default response reference without a corresponding definition; the subset preserves that upstream behavior. The selected commands were verified with the official binary and local HTTP fixtures.

Writes are intentionally excluded until provider retry behavior and real-account write acceptance are verified. Automatic token refresh, real enterprise permissions and credential-file isolation still require authenticated acceptance testing.
