# Gateway console

The Gateway keeps xopc available to the web console, desktop app, mobile app, messaging channels, Automations, and remote clients. For local terminal chat alone, you can use `xopc` without starting it separately.

## Start locally

```bash
xopc gateway
```

Open the printed URL, normally `http://127.0.0.1:18790`. The foreground process remains attached to the terminal; press `Ctrl+C` to stop it.

Check status from another terminal:

```bash
xopc gateway status
xopc gateway health
```

## Run in the background

For channels, mobile access, Webhooks, and scheduled work, install the operating-system service:

```bash
xopc gateway service install
xopc gateway status
```

Use `xopc gateway service --help` for platform-specific service commands. The desktop app can also manage its local Gateway without a separate terminal.

## Authentication token

Local browser access may not prompt for a token, but other clients and remote connections should use one.

```bash
xopc config token
xopc config token --generate
```

Treat the token like a password. Store it only in trusted clients, never in screenshots, public URLs, or source control. Generating a new token disconnects clients using the old one.

## Common controls

```bash
xopc gateway restart
xopc gateway stop
xopc gateway logs
xopc gateway probe
```

Use `restart` after changes to extensions, channel credentials, process environment, or runtime dependencies. Many ordinary configuration changes reload automatically.

## Access from another device

The default loopback binding is deliberately local. Choose a protected access method before changing it:

- [Tailscale](./gateway/tailscale.md) for trusted personal devices;
- [SSH tunnel](./gateway/remote.md) for administrator access to a remote host;
- [Remote access guide](./remote-access.md) for LAN and public options.

Never expose an unauthenticated Gateway directly to the public internet.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Port is already in use | Stop the other process or change `gateway.port` |
| Console shows unauthorized | URL and token belong to the same Gateway |
| Status is running but a channel is unhealthy | `xopc gateway health` and channel logs |
| Service works in a terminal but not at boot | Service environment, absolute paths, and credentials |
| Browser cannot connect remotely | Binding, firewall, tunnel, TLS, and token |

Run `xopc doctor --security` before exposing the Gateway beyond the local computer.
