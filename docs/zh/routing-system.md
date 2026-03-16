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

### Agent 配置

```yaml
agents:
  default: main
  list:
    - id: main
      name: 主助手
    - id: coder
      name: 编程助手
```

### Binding 路由规则

```yaml
bindings:
  - agentId: coder
    match:
      channel: telegram
      peerId: "-100*"
    priority: 100

  - agentId: main
    match:
      channel: "*"
    priority: 0
```

### Identity Links（跨平台身份合并）

```yaml
session:
  identityLinks:
    alice:
      - telegram:123456789
      - discord:987654321
```

## API

### 生成 Session Key

```typescript
import { buildSessionKey } from './routing/index.js';

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
import { resolveRoute } from './routing/index.js';

const route = resolveRoute({
  config,
  channel: 'telegram',
  accountId: 'default',
  peerKind: 'group',
  peerId: '-100123456',
});

console.log(route.sessionKey); // main:telegram:default:group:-100123456
console.log(route.agentId);    // main
```

## 相关文件

- `src/routing/` - 路由系统核心
- `src/channels/telegram/routing-integration.ts` - Telegram 集成
- `src/acp/routing-integration.ts` - ACP 集成
