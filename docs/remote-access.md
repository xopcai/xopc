# Remote access

Connect to your gateway from another device — phone, laptop, or a remote server — without exposing more than you need.

**Settings UI:** Gateway console → **Settings → Remote access** (`#/settings/remote-access`).

Only **one public exposure mode** should be active at a time (Tailscale Serve **or** the public FRP tunnel). The Overview tab shows conflicts when both are enabled.

---

## Choose a method

| Scenario | Method | Settings tab |
|----------|--------|--------------|
| Personal devices on your Tailscale tailnet | **Tailscale Serve** (recommended) | Tailscale |
| Mobile app / public HTTPS URL from anywhere | **Public tunnel** (FRP) | Public internet |
| CLI/TUI on a laptop, SSH to the host | **SSH tunnel** | SSH tunnel |
| Phone on the same Wi‑Fi | **LAN bind** | Local network → Gateway settings |
| Enterprise SSO in front of the gateway | **Reverse proxy** | Overview (see below) |

See also the [network hub](./network.md) for how these layers fit together.

---

## Overview tab

The Overview tab summarizes what is active on **this** gateway:

- **Tailscale Serve** — tailnet HTTPS status
- **Public tunnel** — FRP connection state
- **SSH tunnel** — CLI port-forwarding command
- **Local network** — LAN bind shortcut to Gateway settings
- **Reverse proxy** — notes when the gateway sits behind nginx, Caddy, or similar

Pick a method card to jump to the matching tab. If Tailscale and the public tunnel are both enabled, fix the conflict before switching.

---

## Tailscale Serve {#tailscale-serve}

Best when every client is on your **Tailscale tailnet**. The gateway process stays on `127.0.0.1`; Tailscale publishes HTTPS on your MagicDNS hostname.

### In the settings UI

1. Install [Tailscale](https://tailscale.com/download) on the gateway host and sign in.
2. Open **Remote access → Tailscale**.
3. Click **Enable Serve**.
4. Copy the `https://<hostname>/` URL and open it from any device on the tailnet.
5. Sign in to the web console with your **gateway Bearer token** (API routes always require the token).

### Configuration

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
xopc tailscale status
```

### Notes

- **Serve** requires `gateway.bind=loopback`.
- **Funnel** (public HTTPS via Tailscale) is high risk and requires password auth — see [Tailscale](./gateway/tailscale.md).
- Tailscale exposure and `tunnel.autoStart` are **mutually exclusive**.

More detail: [Tailscale Serve / Funnel](./gateway/tailscale.md).

---

## Public internet (FRP tunnel) {#public-tunnel}

Use when you need a **public HTTPS URL** — for example mobile app pairing or reaching the gateway from outside your tailnet.

Traffic is proxied through **frp.xopc.ai**. Treat this as **high risk**: anyone with the URL or pairing QR may reach your gateway if they obtain your Bearer token.

### In the settings UI

1. Open **Remote access → Public internet**.
2. Read the security notice and click **Start remote access** (consent required on first start).
3. Wait for the public URL (first start can take 1–3 minutes while HTTPS is provisioned).
4. Open **Mobile app pairing** below the control card and scan the QR (or copy the pairing link).
5. Stop the tunnel when you no longer need remote access.

### Broker registration secret

Connecting to the production broker requires a **registration secret** (not the gateway token):

| Source | Priority |
|--------|----------|
| `XOPC_TUNNEL_REGISTRATION_SECRET` env | 1 (wins) |
| `tunnel.registrationSecret` in `xopc.json` | 2 |
| Dev default | 3 (non-production brokers only) |

Set the secret under **Advanced settings** on the Public internet tab, or:

```bash
xopc tunnel secret set
```

### Options

- **Auto-start** — start the tunnel whenever the gateway launches (requires valid consent and a prior successful start).
- **Release public URL** — deregister the subdomain on the broker; the next start gets a new URL.

### Configuration (summary)

| Field | Meaning |
|-------|---------|
| `tunnel.enabled` | User turned remote access on |
| `tunnel.autoStart` | Start tunnel when gateway listens |
| `tunnel.consent` | Record of accepting the security notice |
| `tunnel.registrationSecret` | Broker registration secret |

Full security model, API, and CLI: [FRP tunnel security](./tunnel-security.md).

---

## SSH tunnel (CLI) {#ssh-tunnel}

When you can SSH to the host but do not want a public URL, open **Remote access → SSH tunnel** for the copy-ready command, or run:

```bash
xopc gateway ssh-tunnel --target user@your-host --local-port 18790 --remote-port 18790
# equivalent:
ssh -N -L 18790:127.0.0.1:18790 user@your-host
```

Then open `http://127.0.0.1:18790` locally.

### Persistent CLI remote mode

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

CLI/TUI/MCP use `gateway.remote` when `gateway.mode=remote`. Override with `XOPC_GATEWAY_URL`.

More: [Remote access (SSH + CLI)](./gateway/remote.md).

---

## Same network (LAN) {#lan}

For phones or laptops on the **same Wi‑Fi** without public exposure, open **Remote access → Local network**, then:

1. Open **Settings → Gateway**.
2. Set **Bind** to your LAN IP or `0.0.0.0` (with token auth and sensible firewall rules).
3. Connect with `http://<lan-ip>:<port>`.

The Public internet tab can suggest LAN addresses for mobile pairing when the gateway is still on loopback.

---

## Reverse proxy & enterprise front door {#advanced}

When nginx, Caddy, or Pomerium terminates TLS and authenticates users:

- Keep `gateway.bind=loopback`.
- Configure [trusted proxy auth](./gateway/trusted-proxy.md).
- Block direct access to the gateway port from the internet.

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Overview shows a conflict | Disable Tailscale Serve or stop the public tunnel |
| Public tunnel won’t start | Registration secret set? Consent accepted? See logs `TunnelAudit` |
| Mobile QR says localhost blocked | Enable LAN bind or start the public tunnel |
| Tailscale Enable fails | Tailscale installed and logged in? `gateway.bind=loopback`? |
| CLI can’t reach remote gateway | `gateway.mode=remote`, SSH tunnel running, token in `gateway.remote` |

---

## Related docs

- [Network hub](./network.md)
- [Tailscale Serve / Funnel](./gateway/tailscale.md)
- [FRP tunnel security](./tunnel-security.md)
- [SSH & CLI remote mode](./gateway/remote.md)
- [Trusted proxy auth](./gateway/trusted-proxy.md)
- [Gateway configuration](./gateway.md)
- [Configuration reference](./configuration.md)
