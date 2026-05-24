# Remote access

Use these patterns when the gateway runs on another machine (VPS, home server, sleeping laptop host).

## SSH tunnel (universal fallback)

Forward the remote gateway loopback port to your laptop:

```bash
ssh -N -L 18790:127.0.0.1:18790 user@gateway-host
# or
xopc gateway ssh-tunnel --target user@gateway-host
```

Then open `http://127.0.0.1:18790` locally.

## Persistent CLI remote target

```json5
{
  gateway: {
    mode: "remote",
    remote: {
      url: "http://127.0.0.1:18790",
      token: "your-token",
      transport: "ssh",
      sshTarget: "user@gateway-host",
    },
  },
}
```

CLI/TUI/MCP read `gateway.remote` when `gateway.mode=remote`. Override with `XOPC_GATEWAY_URL`.

## Tailnet (recommended)

Keep `gateway.bind=loopback` and enable [Tailscale Serve](./tailscale.md).

## Public internet (advanced)

Use the managed [FRP tunnel](./../tunnel-security.md) with consent — not for everyday use.

## Decision tree

1. Same Tailnet? → Tailscale Serve
2. SSH to host? → SSH tunnel + `gateway.mode=remote`
3. Need public URL / mobile QR? → FRP tunnel
4. Enterprise front door? → trusted-proxy + Caddy/nginx

See also [network.md](../network.md).
