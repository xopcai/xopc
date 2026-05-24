# Network hub

This page links the core docs for how xopc connects and secures remote access to the gateway.

## Core model

- **Loopback first:** the gateway defaults to `http://127.0.0.1:18790`.
- **One gateway per host** owns channels, sessions, and config.
- **Remote access layers:** Tailscale Serve (tailnet), SSH tunnel (CLI), FRP public tunnel (advanced), LAN bind, reverse proxy.

## Recommended paths

| Scenario | Path |
|----------|------|
| **Settings UI walkthrough** | **[Remote access guide](./remote-access.md)** |
| Tailnet phone / laptop | [Tailscale Serve](./gateway/tailscale.md) |
| VPS / home server | loopback + SSH or Tailscale Serve — [Remote access](./gateway/remote.md) |
| Public / mobile QR | [FRP tunnel](./tunnel-security.md) (consent required) |
| Enterprise OAuth | [Trusted proxy](./gateway/trusted-proxy.md) |

## Docs

- **[Remote access (settings guide)](./remote-access.md)**
- [Remote access (SSH + CLI remote mode)](./gateway/remote.md)
- [Tailscale Serve / Funnel](./gateway/tailscale.md)
- [FRP tunnel security](./tunnel-security.md)
- [Trusted proxy auth](./gateway/trusted-proxy.md)
- [Configuration](./configuration.md)
