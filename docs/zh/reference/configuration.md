# 配置参考

当你需要查准确配置位置时使用本页。

主配置文件默认为 `~/.xopc/xopc.json`，也可通过 `XOPC_CONFIG` 或 `XOPC_CONFIG_PATH` 指定其它路径。

完整字段说明见 [配置](../configuration.md)。任务型设置优先看：

- [配置第一个模型](../how-to/configure-first-model.md)
- [接入 Telegram](../how-to/connect-telegram.md)
- [安全暴露网关](../how-to/expose-gateway-safely.md)
- [创建第二个 agent](../how-to/create-second-agent.md)
- [诊断损坏的设置](../how-to/diagnose-broken-setup.md)

## 顶层配置段

| 段 | 用途 |
| --- | --- |
| `agents` | Agent manifests、可选 capability presets、默认 agent id |
| `providers` | LLM provider API key 引用和 provider id |
| `bindings` | 将入站 channel / peer 路由到 agent |
| `session` | 会话 scope、identity links、reset 行为 |
| `channels` | Telegram、微信、飞书和扩展 channel 配置 |
| `gateway` | HTTP/SSE gateway host、port、auth、CORS、远程访问 |
| `browser` | 浏览器自动化后端、URL 策略、超时 |
| `tools` | Web search 和其它工具级设置 |
| `messages` / `tts` | 出站消息和 TTS 设置 |
| `mcp` | 出站 MCP server registry |
| `extensions` | 扩展开关和扩展专属配置 |

## Agent 配置

当前 agent 配置是 manifest-first：

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

当前没有 `agents.defaults` 合并层。可运行的 agent 写在 `agents.list[]`；只有需要复用策略补丁时才使用 `agents.capabilityPresets` 和 `agents.defaultPreset`。
