# Configuration reference

Use this page when you need exact locations for xopc configuration.

The main configuration file is `~/.xopc/xopc.json` unless `XOPC_CONFIG` or `XOPC_CONFIG_PATH` points elsewhere.

For the full field reference, see [Configuration](../configuration.md). For task-oriented setup, prefer:

- [Configure your first model](../how-to/configure-first-model.md)
- [Connect Telegram](../how-to/connect-telegram.md)
- [Expose the gateway safely](../how-to/expose-gateway-safely.md)
- [Create a second agent](../how-to/create-second-agent.md)
- [Diagnose a broken setup](../how-to/diagnose-broken-setup.md)

## Top-level sections

| Section | Purpose |
| --- | --- |
| `agents` | Agent manifests, optional capability presets, default agent id |
| `providers` | LLM provider API key references and provider ids |
| `bindings` | Route inbound channels/peers to agents |
| `session` | Session scope, identity links, reset behavior |
| `channels` | Telegram, Weixin, Feishu, and extension channel config |
| `gateway` | HTTP/SSE gateway host, port, auth, CORS, remote access |
| `browser` | Browser automation backend, URL policy, timeout behavior |
| `tools` | Web search and other tool-level settings |
| `messages` / `tts` | Outbound message and text-to-speech settings |
| `mcp` | Outbound MCP server registry |
| `extensions` | Extension enable/disable and extension-specific config |

## Agent configuration

Current agent configuration is manifest-first:

```json
{
  "agents": {
    "default": "main",
    "list": [
      {
        "id": "main",
        "identity": { "name": "Main", "role": "General assistant" },
        "responsibilities": { "primary": ["Help the user complete tasks"] },
        "workspace": { "root": "~/.xopc/workspace/main" },
        "models": {
          "defaultRole": "deep",
          "roles": {
            "deep": { "model": "deepseek/deepseek-v4-flash" }
          }
        },
        "tools": { "builtin": {} },
        "skills": { "mode": "all" },
        "memory": { "mode": "confirmWrite", "sources": ["session"] },
        "workflows": {},
        "boundaries": { "requiresConfirmation": [], "forbidden": [], "escalation": [] }
      }
    ]
  },
  "providers": {
    "deepseek": "${DEEPSEEK_API_KEY}"
  }
}
```

There is no `agents.defaults` merge layer. Put runnable agents in `agents.list[]`. Use `agents.capabilityPresets` and `agents.defaultPreset` only when you want reusable policy patches.
