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
