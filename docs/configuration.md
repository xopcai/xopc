# Configure xopc

Use the desktop or web console for routine settings. Use `xopc config` for terminal changes, automation, and diagnosis. Edit `xopc.json` directly only when a setting is not available in the UI.

## Find the active configuration

```bash
xopc config path
xopc config show
xopc config validate
```

The default file is `~/.xopc/xopc.json`. A profile, command-line option, or environment variable can select another file, so `xopc config path` is more reliable than assuming the default.

## Change a setting safely

Use dot paths with the CLI:

```bash
xopc config get agents.default
xopc config set agents.default main
xopc config unset gateway.remote.url
xopc config validate
```

Values that look like JSON are parsed as JSON. Quote strings when your shell requires it.

After a change:

1. run `xopc config validate`;
2. restart the affected service if the UI does not show the new value;
3. perform one small verification action;
4. check logs before making more changes.

The Gateway reloads many settings automatically, but credentials, extensions, channels, and runtime changes may require a restart.

## Common settings

| Goal | Recommended place | Guide |
| --- | --- | --- |
| Add a provider or choose a model | **Settings → Capabilities → Models** | [Models](./models.md) |
| Create an Agent | **Agents** | [Agents](./routing-system.md) |
| Enable tools | Agent editor | [Tools](./tools.md) |
| Install or configure a Skill | **Skills** | [Skills](./skills.md) |
| Connect an MCP server | **Settings → Agent MCP** | [MCP](./mcp.md) |
| Connect a messaging app | **Channels** | [Channels](./channels/index.md) |
| Enable remote access | **Settings → Remote access** | [Remote access](./remote-access.md) |
| Change voice or image providers | **Settings → Capabilities** | [Voice](./voice.md), [Images](./image-multimodal.md) |

## Editing JSON directly

Back up the file first, keep the JSON syntax valid, and change one section at a time. A minimal shape is:

```json
{
  "agents": {
    "default": "main",
    "list": [
      {
        "id": "main",
        "enabled": true
      }
    ]
  },
  "gateway": {
    "port": 18790
  }
}
```

Do not copy this over an existing configuration; it intentionally omits most settings. Use [Configuration reference](./reference/configuration.md) to find the relevant section.

## Secrets

Prefer the credential controls in the UI or commands such as `xopc providers set-key`. Credentials may live in auth profiles or environment variables instead of the main JSON file.

- Never commit `xopc.json`, `.env`, or auth files containing secrets.
- Do not share `config show` output without reviewing it, even though known secrets are masked.
- Rotate a token immediately if it appears in chat, logs, screenshots, or source control.

## Profiles and overrides

xopc can use separate state profiles and alternate paths. When behavior differs between clients, compare:

```bash
xopc profile list
xopc config path
```

The most common cause is that two clients use different state directories, configuration files, or Gateway URLs.

For exact top-level fields, environment variables, and data locations, see [Configuration reference](./reference/configuration.md) and [Data and file locations](./workspace.md).
