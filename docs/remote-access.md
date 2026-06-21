# Remote access

Connect to your gateway from another device — phone, laptop, or a remote server — without exposing more than you need.

**Settings UI:** Gateway console → **Settings → Remote access** (`#/settings/remote-access`).

For iOS/Android, use **[xopc-app](https://github.com/xopcai/xopc-app)** with a running gateway. See [Mobile app](./mobile-app.md) for the app-specific setup path.

Only **one public exposure mode** should be active at a time (Tailscale Serve **or** the public FRP tunnel). The Overview tab shows conflicts when both are enabled.

---

## Choose a method

| Scenario | Method | Settings tab |
|----------|--------|--------------|
| Personal devices on your Tailscale tailnet | **Tailscale Serve** (recommended) | Tailscale |
| Mobile app / public HTTPS URL from anywhere | **Public tunnel** (FRP) | Public internet |
| Self-hosted HTTPS at your own domain | **Reverse proxy** (Caddy / nginx / Cloudflare Tunnel) | Reverse proxy |
| CLI/TUI on a laptop, SSH to the host | **SSH tunnel** | SSH tunnel |
| Phone on the same Wi‑Fi | **LAN bind** | Local network → Gateway settings |
| Enterprise SSO in front of the gateway | **Trusted-proxy auth** (advanced) | (see advanced section below) |

See also the [network hub](./network.md) for how these layers fit together.

---

## Overview tab

The Overview tab summarizes what is active on **this** gateway:

- **Tailscale Serve** — tailnet HTTPS status
- **Public tunnel** — FRP connection state
- **Reverse proxy** — configured `gateway.publicUrl` (self-deployed HTTPS)
- **SSH tunnel** — CLI port-forwarding command
- **Local network** — LAN bind shortcut to Gateway settings

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

Use when you need a **public HTTPS URL** — for example [xopc-app](https://github.com/xopcai/xopc-app) pairing or reaching the gateway from outside your tailnet.

Traffic is proxied through **frp.xopc.ai**. Treat this as **high risk**: anyone with the URL or pairing QR may reach your gateway if they obtain your Bearer token.

### In the settings UI

1. Open **Remote access → Public internet**.
2. Read the security notice and click **Start remote access** (consent required on first start).
3. Wait for the public URL (first start can take 1–3 minutes while HTTPS is provisioned).
4. Open **Mobile app pairing** below the control card and scan the QR with [xopc-app](./mobile-app.md) (or copy the pairing link).
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

## Reverse proxy (self-hosted HTTPS) {#reverse-proxy}

Front the gateway with **your own HTTPS reverse proxy** (Caddy, nginx, Cloudflare Tunnel, etc.) at a custom domain such as `https://gateway.example.com`. The proxy terminates TLS and forwards to the loopback gateway; [xopc-app](./mobile-app.md) pairs over the public URL.

This is **distinct from** trusted-proxy auth (see [Advanced](#advanced)): here the proxy is just a TLS / domain shim — the gateway still authenticates clients with its own Bearer token. No SSO required.

### When to use it

- You already run a domain + TLS cert (Let's Encrypt, Cloudflare, commercial CA).
- You want a memorable URL like `https://xopc.yourdomain.com` instead of `*.frp.xopc.ai`.
- You need IP-allowlisting / WAF in front of the gateway.
- You're behind CGNAT and use Cloudflare Tunnel / Tailscale Funnel as the reverse proxy.

### In the settings UI

1. Open **Remote access → Reverse proxy**.
2. If you already accessed the console through the proxy (the URL bar shows `https://gateway.example.com`), the tab **auto-detects** the URL and shows a pairing QR immediately — no save required.
3. Click **Test** to round-trip `/api/tunnel/pair/ping` and verify TLS + DNS + reachability.
4. Click **Save as default** to persist as `gateway.publicUrl`. Then other clients (and restarts) see the same URL.
5. Scan the QR from [xopc-app](https://github.com/xopcai/xopc-app).

The mobile app stores the URL as the primary `baseUrl` and falls back to LAN / FRP if reachable.

### Configuration

```json5
{
  gateway: {
    bind: "loopback",                       // proxy connects via localhost
    port: 18790,
    auth: { mode: "token", token: "…" },
    publicUrl: "https://gateway.example.com",  // NEW
  },
}
```

- `publicUrl` must use **https** for public hostnames; `http` is allowed only for RFC1918 / `.local`.
- No path, no query, no userinfo. Trailing `/` is stripped.
- The configured URL is automatically added to the CORS/CSRF allowlist.
- When both reverse-proxy and FRP are active, **reverse-proxy is preferred** by the mobile app; FRP remains as a fallback in `connectUrls`.

### Reverse-proxy templates

**Caddy** (auto Let's Encrypt):

```caddy
gateway.example.com {
  reverse_proxy 127.0.0.1:18790 {
    flush_interval -1                     # SSE: disable response buffering
    transport http { keepalive 90s }
  }
}
```

**nginx:**

```nginx
server {
  listen 443 ssl http2;
  server_name gateway.example.com;
  ssl_certificate     /etc/letsencrypt/live/gateway.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/gateway.example.com/privkey.pem;

  location / {
    proxy_pass         http://127.0.0.1:18790;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Forwarded-Proto https;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_buffering    off;               # SSE: disable response buffering
    proxy_read_timeout 3600s;             # long-lived SSE / WS
  }
}
```

### Requirements

| Requirement | Why |
|---|---|
| **System-trusted TLS cert** (Let's Encrypt / commercial CA) | Mobile apps reject self-signed certs (iOS ATS, Android default config). Self-signed is **not supported in v1**. |
| `proxy_buffering off` (nginx) / `flush_interval -1` (Caddy) | SSE streams (`/api/events`, `/api/agent/stream`) must flush immediately. |
| Long idle timeout (≥ 60s, ideally hours) | Chat and event streams stay open. |
| Do **not** strip `Authorization` header | The gateway authenticates with its own Bearer token. |
| `/health` and `/api/tunnel/pair/ping` must be reachable | Used for mobile preflight + the "Test" button in the UI. |

### Troubleshooting

| Symptom | Check |
|---|---|
| Mobile shows "Reverse proxy did not respond" | Run the **Test** button. TLS cert valid? DNS resolves? `/api/tunnel/pair/ping` reachable? |
| Browser console shows CORS / 403 errors | Make sure your TCP connection comes from loopback (proxy on same host) **or** add the proxy IP to `gateway.trustedProxies`. |
| SSE streams stall after a few seconds | Disable proxy buffering. nginx: `proxy_buffering off`. Caddy: `flush_interval -1`. |
| Mobile pairs but disconnects after a minute | Increase proxy idle timeout. |
| The QR works locally but not over cellular | Public DNS / firewall — the URL must resolve and be reachable from outside your network. |

---

## Same network (LAN) {#lan}

For phones or laptops on the **same Wi‑Fi** without public exposure, open **Remote access → Local network**, then:

1. Open **Settings → Gateway**.
2. Set **Bind** to your LAN IP or `0.0.0.0` (with token auth and sensible firewall rules).
3. Connect with `http://<lan-ip>:<port>`.

The Public internet tab can suggest LAN addresses for mobile pairing when the gateway is still on loopback.

---

## Advanced: trusted-proxy authentication {#advanced}

For the case where the **reverse proxy itself authenticates users** (Pomerium, oauth2-proxy, enterprise SSO, etc.) and you want the gateway to trust the user identity from request headers — distinct from the [Reverse proxy](#reverse-proxy) tab, which keeps Bearer-token auth:

- Keep `gateway.bind=loopback`.
- Configure [trusted proxy auth](./gateway/trusted-proxy.md): `gateway.auth.mode = "trusted-proxy"`, set `trustedProxies` CIDRs, and `auth.trustedProxy.userHeader`.
- Block direct access to the gateway port from the internet.

The mobile pairing flow does **not** use this mode (the phone has no SSO identity to present).

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Overview shows a conflict | Disable Tailscale Serve or stop the public tunnel |
| Public tunnel won’t start | Registration secret set? Consent accepted? See logs `TunnelAudit` |
| Mobile QR says localhost blocked | Enable LAN bind, start the public tunnel, or configure reverse proxy |
| Tailscale Enable fails | Tailscale installed and logged in? `gateway.bind=loopback`? |
| CLI can’t reach remote gateway | `gateway.mode=remote`, SSH tunnel running, token in `gateway.remote` |
| Reverse-proxy: "Test" button fails with TLS error | Cert not trusted (self-signed?), wrong SNI, or expired cert |
| Reverse-proxy: SSE streams cut after seconds | `proxy_buffering off` (nginx) / `flush_interval -1` (Caddy) missing |

---

## Related docs

- [Network hub](./network.md)
- [Tailscale Serve / Funnel](./gateway/tailscale.md)
- [FRP tunnel security](./tunnel-security.md)
- [SSH & CLI remote mode](./gateway/remote.md)
- [Trusted proxy auth](./gateway/trusted-proxy.md)
- [Gateway configuration](./gateway.md)
- [Configuration reference](./configuration.md)
