# Session 路由系统

xopcbot 的 Session 路由系统提供统一的消息路由和会话管理机制。

## Session Key 格式

```
{agentId}:{source}:{accountId}:{peerKind}:{peerId}[:thread:{threadId}]
```

| 字段 | 说明 | 示例 |
|------|------|------|
| `agentId` | Agent 标识符 | `main`, `coder` |
| `source` | 消息来源 | `telegram`, `gateway`, `cli` |
| `accountId` | 账号标识 | `default`, `work` |
| `peerKind` | 对话类型 | `dm`, `group`, `direct` |
| `peerId` | 对话 ID | `123456`, `-100123456` |

### 示例

```
main:telegram:default:dm:123456
main:telegram:default:group:-100123456
main:gateway:default:direct:chat_abc123
main:cli:default:direct:cli
```

## 配置

路由写在 **`~/.xopcbot/config.json`** 中（可用环境变量 `XOPCBOT_CONFIG` 覆盖路径）。请使用 **JSON**，不要使用 YAML。

### Agent 与 bindings

在 `agents.list` 中注册多个 Agent。**绑定规则** `bindings` 按 **priority** 从高到低匹配；每条 `match` 中的 **`channel`** 为**精确**通道 id（如 `telegram`、`gateway`），匹配时不区分大小写，**不支持**用 `*` 表示「所有通道」。可按通道分别写规则；若没有任何规则匹配，则使用**默认 Agent**：`agents.list` 中第一个 **enabled** 的 `id`，否则为 `main`。

`match.peerId` 支持简单的 `*` 通配（例如 Telegram 超级群 `-100*`）。

```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5"
    },
    "list": [
      { "id": "main", "name": "主助手" },
      { "id": "coder", "name": "编程助手" }
    ]
  },
  "bindings": [
    {
      "agentId": "coder",
      "priority": 100,
      "match": {
        "channel": "telegram",
        "peerId": "-100*"
      }
    }
  ],
  "session": {
    "identityLinks": {
      "alice": ["telegram:123456789", "discord:987654321"]
    }
  }
}
```

### Identity links（跨通道别名）

`session.identityLinks` 将 **规范名** 映射到 **`channel:peerId`** 别名列表，便于跨通道识别同一用户。`session.dmScope` 等选项见 [配置参考](/zh/configuration)。

## API

### 生成 Session Key

```typescript
import { buildSessionKey } from '@xopcai/xopcbot/routing/index.js';

const sessionKey = buildSessionKey({
  agentId: 'main',
  source: 'telegram',
  accountId: 'default',
  peerKind: 'dm',
  peerId: '123456',
});
```

### 路由决策

```typescript
import { resolveRoute } from '@xopcai/xopcbot/routing/index.js';

const route = resolveRoute({
  config,
  channel: 'telegram',
  accountId: 'default',
  peerKind: 'dm',
  peerId: '123456',
});

console.log(route.sessionKey); // 例如 main:telegram:default:dm:123456（受 dmScope 影响）
console.log(route.agentId); // 无匹配规则时的默认 Agent（例如 main）
```

## 相关文件

- `src/routing/` - 路由系统核心
- `extensions/telegram/src/routing-integration.ts` - Telegram 集成（工作区包 `@xopcai/xopcbot-extension-telegram`）
- `src/acp/routing-integration.ts` - ACP 集成
