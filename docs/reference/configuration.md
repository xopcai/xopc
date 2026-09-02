# Configuration reference

This page maps the main configuration areas. For a specific installed version, `xopc config show`, `xopc config get <path>`, and the settings UI are the authoritative view of effective values.

## Locations and commands

Default file: `~/.xopc/xopc.json`.

```bash
xopc config path
xopc config show
xopc config get <dot.path>
xopc config set <dot.path> <value>
xopc config unset <dot.path>
xopc config validate
```

`XOPC_CONFIG` or `XOPC_CONFIG_PATH` can select another configuration file. State profiles can also change the default root.

## Top-level areas

| Section | Controls |
| --- | --- |
| `agents` | One inherited default (`agents.defaults`) plus Agent profiles and explicit overrides (`agents.list`) |
| `userContext` | Shared user-owned context, privacy, and recall behavior |
| `providers` | Model provider configuration and credential references |
| `channels` | Telegram, Weixin, Feishu, and extension channel settings |
| `gateway` | Port, binding, authentication, remote connection, and Tailscale behavior |
| `tools` | Search, browser, media, runtime, and other tool settings |
| `messages` | Outbound message and text-to-speech behavior |
| `mcp` | External MCP server connections and lifecycle settings |
| `extensions` | Extension enable/disable and extension-specific configuration |
| `runtimeTools` | Managed Node.js and Python runtimes |
| `heartbeat` | Periodic Agent checks when enabled |

Workflows and Automations are normally managed in their own Gateway pages rather than written directly into `xopc.json`.

## Common path overrides

| Variable | Purpose |
| --- | --- |
| `XOPC_STATE_DIR` | State root |
| `XOPC_CONFIG` / `XOPC_CONFIG_PATH` | Configuration file |
| `XOPC_WORKSPACE` | Primary workspace override |
| `XOPC_CREDENTIALS_DIR` | Credential directory |
| `XOPC_LOG_DIR` | Log directory |
| `XOPC_LOG_LEVEL` | Log verbosity |

Provider-specific variables such as `OPENAI_API_KEY` are shown by provider setup and `xopc providers schema <provider>`.

## Validation and secrets

Run `xopc config validate` after direct edits. Use JSON syntax: no trailing commas or duplicate keys. Prefer UI or CLI credential commands for secrets, and review any output before sharing it.

Task-oriented instructions are in [Configure xopc](../configuration.md).
