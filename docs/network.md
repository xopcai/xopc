# Network access

xopc starts with the Gateway available only on the local computer. Keep that default unless another device or service genuinely needs access.

## Choose a protected path

| Scenario | Guide |
| --- | --- |
| Personal laptop and phone | [Tailscale](./gateway/tailscale.md) |
| Administrator access to a remote host | [SSH tunnel](./gateway/remote.md) |
| Trusted private LAN | [Remote access](./remote-access.md#lan-access) |
| Public URL | [Public tunnel security](./tunnel-security.md) |
| Existing enterprise identity proxy | [Trusted proxy](./gateway/trusted-proxy.md) |

Generate a Gateway token and run `xopc doctor --security` before allowing access beyond loopback. Do not turn off authentication to solve a networking problem.

The main decision and troubleshooting guide is [Remote access](./remote-access.md).

## Outbound HTTP proxy

Open **Settings → Local service → Network → Outbound proxy** to configure Gateway HTTP requests, including model and OAuth requests that use Node fetch. Save and restart the Gateway to apply changes.

- **Startup environment** (default): use `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` (lowercase variants take precedence).
- **Custom proxy**: use one HTTP or HTTPS proxy origin for both HTTP and HTTPS destinations, overriding startup proxy variables.
- **Direct connection**: ignore startup HTTP proxy variables.

```json
{
  "gateway": {
    "outboundProxy": {
      "mode": "custom",
      "url": "http://127.0.0.1:7897",
      "noProxy": ".internal.example,192.168.1.10"
    }
  }
}
```

`localhost`, `127.0.0.1`, and `::1` always connect directly. Bypass entries are comma-separated hosts or domain suffixes; `*` bypasses all destinations. Proxy URLs must be HTTP(S) origins without credentials, paths, queries, or fragments. SOCKS proxies are not supported. This setting does not configure external subprocesses or independently managed WebSocket clients.
