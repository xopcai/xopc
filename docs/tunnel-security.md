# Remote access (tunnel) security

> **Settings walkthrough:** [Remote access guide](./remote-access.md#public-tunnel) (Public internet tab).

Remote access exposes your **local gateway** on the public internet via FRP (`frp.xopc.ai`). Treat it as high risk.

## Defaults

- Tunnel is **off** on install and on gateway / Electron startup.
- **frpc** is downloaded only when you start remote access (`tunnel start` or the settings UI).
- Electron release builds **do not** bundle frpc.
- Cached binary: `{stateDir}/bin/frpc` (default `~/.xopc/bin/frpc`; honors `XOPC_STATE_DIR`).
- While a tunnel is active, the gateway sets `XOPC_FRPC_PATH` to the resolved binary; it is cleared on stop.

## Broker registration secret

Connecting to the production broker (`frp.xopc.ai`) requires a **registration secret** (not the gateway Bearer token).

| Source | Priority | Notes |
|--------|----------|--------|
| `XOPC_TUNNEL_REGISTRATION_SECRET` | 1 (wins) | Shell / Electron parent env; overrides config |
| `tunnel.registrationSecret` in `xopc.json` | 2 | Remote access settings, or `xopc tunnel secret set` |
| Dev default | 3 | Only for non-production brokers (localhost, etc.) |

The web UI masks saved secrets (`••••••••••••`); PATCH with masked sentinels leaves the stored value unchanged. Send `null` to clear.

## Prefetch (optional)

```bash
pnpm run electron:frpc:download   # current OS/arch → ~/.xopc/bin
node scripts/download-frpc-binaries.mjs --all   # all platforms (mirrors / CI)
```

Prefetch is not required; the first tunnel start downloads if the cache is missing.

## Consent (versioned)

Before the first start (and again when we bump the consent version), you must accept the security notice:

- **Config:** `tunnel.consent.version` + `tunnel.consent.acceptedAt`
- **Current version:** see `CURRENT_TUNNEL_CONSENT_VERSION` in `src/tunnel/consent.ts`
- **Web:** confirmation modal on `/settings/tunnel`
- **CLI:** interactive prompt, or `xopc tunnel start --accept-risk` / `xopc tunnel consent`

If the notice text changes, the version string is bumped and existing consent is invalidated until you re-accept.

On gateway load, invalid consent clears `tunnel.enabled` and `tunnel.autoStart` in config (persisted automatically).

## Configuration flags

| Field | Meaning |
|-------|---------|
| `tunnel.enabled` | User has turned remote access on (set on successful start, cleared on stop) |
| `tunnel.autoStart` | Start tunnel when gateway listens (requires valid consent **and** `enabled`) |
| `tunnel.consent` | Record of accepting the security notice |

## Risks (summary)

1. Anyone with your **public URL** or pairing QR may reach the gateway with your Bearer token.
2. Traffic is proxied through **broker / frps** infrastructure.
3. Stopping the tunnel does not instantly revoke all broker-side state; subdomain may remain reserved until expiry.

## Recommendations

- Use a **strong gateway token** and rotate if a URL or QR was exposed.
- Prefer **allowlist** / pairing policies on channels where applicable.
- Stop the tunnel when you do not need remote access.
- Do not enable **autoStart** unless you accept exposure on every gateway launch.

## API

- `POST /api/tunnel/consent` — record acceptance (authenticated)
- `POST /api/tunnel/start` — returns `403` + `TUNNEL_CONSENT_REQUIRED` if consent is missing or outdated
- `POST /api/tunnel/stop` — body `{ "release": false }` (default) keeps broker registration; `release: true` deregisters and clears `tunnel.json`
- `GET /api/tunnel/status` — includes `consentRequired`, `canAutoStart`

Mutating tunnel endpoints are rate-limited per gateway token (12 calls / 5 minutes). Denied starts and consent/start/stop/release are written to logs with prefix `TunnelAudit`.

## CLI

- `xopc tunnel stop` — stop frpc, keep subdomain
- `xopc tunnel stop --release` — deregister and clear saved URL (interactive confirm; `--yes` to skip)
- `xopc tunnel prefetch` — download frpc only, no tunnel exposure
- `xopc tunnel secret set [secret]` — save broker registration secret to config (`--stdin` for scripts)

## Advanced

- Override frpc binary: `XOPC_FRPC_PATH`
- Offline / mirror: host frpc tarballs internally and point downloads at your mirror (see `src/tunnel/frpc-binary.ts`)
- Extraction tries system `tar`, then a built-in Node parser (macOS BSD tar quirks, Windows without `tar`, minimal Linux images)

## Transport TLS (broker-terminated)

Subdomain HTTPS is terminated at the broker with a wildcard certificate (`*.frp.xopc.ai`). The gateway runs **frpc in HTTP mode** directly to the gateway port — no per-gateway ACME or local TLS proxy.

Verify after cutover:

```bash
TUNNEL_PUBLIC_URL=https://{sub}.frp.xopc.ai pnpm run tunnel:phase6:verify
```

## Remote mobile API

The mobile app uses **broker TLS + gateway Bearer token** over `https://{sub}.frp.xopc.ai/api/*` (full path proxy on the broker).

## Application-layer E2EE

When the tunnel is active, remote clients must use `xopc-e2ee-v1` (handshake + relay). See [Mobile E2EE](./mobile-e2ee.md).

### Operations (logs)

Gateway structured logs use prefix **`E2EE:Relay`**. Useful grep patterns on `~/.xopc/logs/app-*.log`:

| Symptom | Grep |
|---------|------|
| REST relay failures | `"E2EE:Relay"` + `"phase":"relay"` |
| Broadcast SSE over tunnel | `"relayPath":"/api/events"` |
| Agent chat over tunnel | `"relayPath":"/api/agent"` |
| Session / seq issues | `"E2EE_SEQ"` or `"E2EE_SESSION"` |
| Stream lifecycle | `"phase":"relay_stream_open"` / `"relay_stream_close"` |

Sessions are persisted under `{stateDir}/e2ee/sessions/` (~24h TTL) so a **gateway restart** does not force mobile re-pairing; clients may still renew on `401`.

Broker nginx ACL updates:

```bash
# xopc-platform repo
./scripts/broker/reload-wildcard-tunnel-nginx.sh --apply
```
