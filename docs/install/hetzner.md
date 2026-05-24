# Hetzner / VPS deployment

Run the gateway on a persistent VPS with **loopback bind** and reach it via SSH or Tailscale.

## Setup

1. Install Node.js >= 22 and xopc.
2. Configure `gateway.bind=loopback` and a strong token.
3. Start: `xopc gateway --background`
4. Access:
   - **Tailscale Serve:** `gateway.tailscale.mode=serve` — see [tailscale.md](../gateway/tailscale.md)
   - **SSH tunnel:** `xopc gateway ssh-tunnel --target user@your-vps` — see [remote.md](../gateway/remote.md)

## Firewall

- Allow SSH (22) or Tailscale; **do not** expose gateway port `18790` publicly unless using FRP/tunnel with consent.

See [network.md](../network.md).
