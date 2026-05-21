# Remote access (tunnel) security

Remote access exposes your **local gateway** on the public internet via FRP (`frp.xopc.ai`). Treat it as high risk.

## Defaults

- Tunnel is **off** on install and on gateway / Electron startup.
- **frpc** is downloaded only when you start remote access (`tunnel start` or the settings UI).
- Electron release builds **do not** bundle frpc.

## Consent (versioned)

Before the first start (and again when we bump the consent version), you must accept the security notice:

- **Config:** `tunnel.consent.version` + `tunnel.consent.acceptedAt`
- **Current version:** see `CURRENT_TUNNEL_CONSENT_VERSION` in `src/tunnel/consent.ts`
- **Web:** confirmation modal on `/settings/tunnel`
- **CLI:** interactive prompt, or `xopc tunnel start --accept-risk` / `xopc tunnel consent`

If the notice text changes, the version string is bumped and existing consent is invalidated until you re-accept.

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
- `GET /api/tunnel/status` — includes `consentRequired`, `canAutoStart`

## Advanced

- Override frpc binary: `XOPC_FRPC_PATH`
- Offline / mirror: host frpc tarballs internally and point downloads at your mirror (see `src/tunnel/frpc-binary.ts`)
