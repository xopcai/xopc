# How to expose the gateway safely

Use this when another device needs to reach your gateway.

## Prefer the narrowest exposure

| Need | Method |
| --- | --- |
| Your own devices on a tailnet | Tailscale Serve |
| Same Wi-Fi only | LAN bind |
| Public HTTPS URL | Public tunnel or reverse proxy |
| Laptop to remote host | SSH tunnel |

Only enable one public exposure method at a time.

## 1. Make sure token auth is enabled

Generate or rotate the gateway token:

```bash
xopc gateway token --generate
```

Check status:

```bash
xopc gateway status
```

## 2. Recommended: Tailscale Serve

Install and sign in to Tailscale on the gateway host, then run:

```bash
xopc gateway --tailscale serve --tailscale-reset-on-exit
xopc tailscale status
```

Open the Tailscale HTTPS URL from another device on the same tailnet. API routes still require the gateway Bearer token.

## 3. Same LAN only

Run the gateway bound to the LAN:

```bash
xopc gateway --bind lan
```

Use this only on a trusted network. Keep the token private.

## 4. Check security posture

```bash
xopc doctor --security
```

For other methods and risks, see [Remote access](../remote-access.md), [Tailscale](../gateway/tailscale.md), and [Trusted proxy](../gateway/trusted-proxy.md).
