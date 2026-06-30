# Session 路由

说明入站流量如何映射到 **session key**、**智能体（`agentId`）**，以及跨通道的 **identity link**（身份关联）。

## Session Key 格式

```
agent:{agentId}:{rest}
```

第一段固定为 `agent`，第二段选择 agent manifest，后续路径取决于 scope 与通道。

### 示例

```
agent:main:main
agent:main:telegram:default:direct:123456
agent:main:telegram:group:-100123456
agent:main:gateway:direct:chat_abc123
agent:main:cli:direct:cli
```

## 配置

路由写在 **`~/.xopc/xopc.json`** 中（可用环境变量 `XOPC_CONFIG` 覆盖路径）。请使用 **JSON**，不要使用 YAML。

### 智能体与 bindings

在 `agents.list` 中注册多个智能体。**绑定规则** `bindings` 按 **priority** 从高到低匹配；每条 `match` 中的 **`channel`** 为**精确**通道 id（如 `telegram`、`gateway`），匹配时不区分大小写，**不支持**用 `*` 表示「所有通道」。可按通道分别写规则；若没有任何规则匹配，**默认智能体 id** 为：可选的顶层 **`agents.default`** → 否则 **`agents.list` 中第一个 enabled 的 id** → 否则 **`main`**。

### 运行时有效配置（effective profile）

对于 `agent:{agentId}:...` session key，运行时会解析 **`agents.list`** 中匹配且 enabled 的 manifest，并应用其 `extends` 声明的 **`agents.capabilityPresets`**。若 `agentId` 不存在或已禁用，则按上面的**默认智能体**解析配置。磁盘上的 `~/.xopc/agents/<id>/` 等路径与上述配置一致解析；**网关/运行时以 `config.json` 为准**。

`match.peerId` 支持简单的 `*` 通配（例如 Telegram 超级群 `-100*`）。

```json
{
  "agents": {
    "default": "main",
    "capabilityPresets": {},
    "list": [
      {
        "id": "main",
        "identity": { "name": "Main", "role": "通用助手", "language": "zh-CN", "tone": "direct" },
        "responsibilities": { "primary": ["帮助用户"] },
        "workspace": { "root": "~/.xopc/workspace/main" },
        "models": { "defaultRole": "deep", "roles": { "deep": { "model": "anthropic/claude-sonnet-4-5" } } },
        "tools": { "builtin": {} },
        "skills": { "mode": "all" },
        "memory": { "mode": "off", "sources": ["session"] },
        "workflows": {},
        "boundaries": { "requiresConfirmation": [], "forbidden": [], "escalation": [] }
      },
      {
        "id": "coder",
        "identity": { "name": "Coder", "role": "编程助手", "language": "zh-CN", "tone": "direct" },
        "responsibilities": { "primary": ["帮助处理代码任务"] },
        "workspace": { "root": "~/.xopc/workspace/coder" },
        "models": { "defaultRole": "deep", "roles": { "deep": { "model": "anthropic/claude-sonnet-4-5" } } },
        "tools": { "builtin": { "shell": { "mode": "confirm", "scope": "workspace" } } },
        "skills": { "mode": "all" },
        "memory": { "mode": "off", "sources": ["session"] },
        "workflows": {},
        "boundaries": { "requiresConfirmation": [], "forbidden": [], "escalation": [] }
      }
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
import { buildSessionKey } from '@xopcai/xopc/routing/index.js';

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
import { resolveRoute } from '@xopcai/xopc/routing/index.js';

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

- **核心路由** — 会话 key、bindings 与规则求值。  
- **Telegram** — 启用 Telegram 通道时提供与通道相关的路由钩子。  
