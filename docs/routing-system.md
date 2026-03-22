# Session Routing System

xopcbot's Session Routing System provides unified message routing and session management.

## Session Key Format

```
{agentId}:{source}:{accountId}:{peerKind}:{peerId}[:thread:{threadId}]
```

| Field | Description | Example |
|-------|-------------|---------|
| `agentId` | Agent identifier | `main`, `coder` |
| `source` | Message source | `telegram`, `gateway`, `cli` |
| `accountId` | Account identifier | `default`, `work` |
| `peerKind` | Conversation type | `dm`, `group`, `direct` |
| `peerId` | Conversation ID | `123456`, `-100123456` |

### Examples

```
main:telegram:default:dm:123456
main:telegram:default:group:-100123456
main:gateway:default:direct:chat_abc123
main:cli:default:direct:cli
```

## Configuration

### Agent Configuration

```yaml
agents:
  default: main
  list:
    - id: main
      name: Main Assistant
    - id: coder
      name: Coding Assistant
```

### Binding Routing Rules

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

### Identity Links (Cross-platform Identity Merging)

```yaml
session:
  identityLinks:
    alice:
      - telegram:123456789
      - discord:987654321
```

## API

### Generate Session Key

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

### Route Resolution

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

## Related Files

- `src/routing/` - Routing system core
- `extensions/telegram/src/routing-integration.ts` - Telegram integration (workspace package `@xopcai/xopcbot-extension-telegram`)
- `src/acp/routing-integration.ts` - ACP integration
