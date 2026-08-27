# Remote access

Remote access lets another device reach your xopc Gateway. Start with the narrowest method that fits your situation and keep token authentication enabled.

## Choose a method

<!-- Screenshot placeholder: /screenshots/remote-access.png -->

| Need | Recommended method | Public internet exposure |
| --- | --- | --- |
| Your own laptop and phone | [Tailscale Serve](./gateway/tailscale.md) | No |
| Temporary administrator access to a server | [SSH tunnel](./gateway/remote.md) | No |
| Trusted devices on one private LAN | LAN binding plus firewall | No |
| A public URL for a webhook or client | Authenticated HTTPS reverse proxy or managed tunnel | Yes |

Tailscale is the best default for personal devices. SSH is the safest universal fallback when you already control the remote host.

## Before enabling access

1. Verify local Chat and Gateway health.
2. Generate a strong Gateway token: `xopc config token --generate`.
3. Back up the configuration.
4. Decide exactly which devices or networks need access.
5. Run `xopc doctor --security`.

## LAN access

Start the Gateway for the local network:

```bash
xopc gateway --bind lan
```

Allow the Gateway port only on a trusted private network, require the token, and use the host's private IP from the other device. Do not use LAN binding on public Wi-Fi.

## Public access

Use a trusted tunnel or HTTPS reverse proxy that preserves authentication. Requirements:

- TLS with a valid certificate;
- a Gateway token or a carefully configured trusted identity proxy;
- firewall rules that expose only the necessary port;
- no debug endpoints or secrets in URLs;
- regular review of access logs and token rotation.

Public exposure increases the impact of mistakes in Agents, tools, channels, and extensions. Prefer private networking when possible.

## Connect a client

Enter the protected Gateway URL and token in the client's connection settings. Verify that health loads before sending a message. If Sessions look unfamiliar, stop: you may be connected to the wrong Gateway.

## Troubleshooting

```bash
xopc gateway probe
xopc gateway status
xopc doctor --security
```

Check the path in order: Gateway binding → host firewall → private network or tunnel → TLS/proxy → token. Avoid disabling authentication as a diagnostic step.
