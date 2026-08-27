# Web console

The web console provides Chat and xopc settings in a browser. It connects to the Gateway and uses the same Sessions, Agents, and local data as the desktop app.

## Open it locally

```bash
xopc gateway
```

Open the URL printed in the terminal, normally `http://127.0.0.1:18790`. If the page requests a token, reveal it with `xopc config token --show` or generate a new one with `xopc config token --generate`, then save it in the connection settings.

## What you can do

- start and resume Chat Sessions;
- manage Agents, Projects, Tasks, Workflows, and Automations;
- configure models, tools, channels, connectors, Skills, MCP, and extensions;
- inspect health, logs, updates, and remote access.

## Access from another device

The default local address is intentionally available only on the Gateway computer. Do not change it to a public listener without authentication and network protection. Follow [Remote access](../remote-access.md) to choose Tailscale, SSH, LAN, or another protected method.

## Troubleshooting

- Blank or disconnected page: run `xopc gateway status` and `xopc gateway health`.
- Unauthorized: confirm the saved Gateway URL and token belong to the same instance.
- Sessions differ from desktop: the browser may be connected to another Gateway or profile.
- Live progress stops: reload once, then inspect Gateway logs for realtime connection errors.
