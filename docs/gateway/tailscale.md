# Tailscale

xopc can auto-configure **Tailscale Serve** (tailnet HTTPS) or **Funnel** (public HTTPS) while the gateway stays on loopback.

## Serve (recommended)

```json5
{
  gateway: {
    bind: "loopback",
    port: 18790,
    auth: { mode: "token", token: "…" },
    tailscale: { mode: "serve", resetOnExit: true },
  },
}
```

CLI one-shot:

```bash
xopc gateway --tailscale serve --tailscale-reset-on-exit
```

Open: `https://<magicdns>/`

Status:

```bash
xopc tailscale status
```

## Direct tailnet bind

```json5
{
  gateway: {
    bind: "tailnet",
    auth: { mode: "token", token: "…" },
  },
}
```

Requires Tailscale connected (`100.x` address).

## Funnel (public — high risk)

```json5
{
  gateway: {
    bind: "loopback",
    auth: { mode: "password", password: "…" },
    tailscale: { mode: "funnel" },
  },
}
```

**Required:** `gateway.auth.mode=password`.

## Guards

- Serve/Funnel require `gateway.bind=loopback`
- Funnel requires password auth
- `tunnel.autoStart` cannot run while Tailscale exposure is enabled

## Identity auth (browser UI)

When `gateway.auth.allowTailscale` is not `false` and mode is `serve`, the web console static UI may accept Tailscale identity headers verified via `tailscale whois`. **All `/api/*` routes still require the gateway Bearer token.**

See [network.md](../network.md).
