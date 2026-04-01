# Session Routing

How inbound traffic maps to **session keys**, **agents**, and optional **identity links** across channels.

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

Routing is configured in **`~/.xopcbot/config.json`** (override path with `XOPCBOT_CONFIG`). Use JSON — not YAML.

### Agents and bindings

Register agents under `agents.list`. **Binding rules** (`bindings`) are evaluated in **priority order** (higher `priority` wins first). Each `match` requires an exact **`channel`** id (e.g. `telegram`, `gateway`) — matching is case-insensitive and **does not** support `*` for “all channels”. Use one rule per channel, or rely on the **default agent** when nothing matches: first **enabled** entry in `agents.list`, otherwise `main`.

`match.peerId` supports simple `*` glob patterns (e.g. `-100*` for Telegram supergroups).

```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5"
    },
    "list": [
      { "id": "main", "name": "Main Assistant" },
      { "id": "coder", "name": "Coding Assistant" }
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

### Identity links (cross-platform aliases)

`session.identityLinks` maps a **canonical** id to a list of **`channel:peerId`** aliases so routing can treat the same person across channels consistently. See [Configuration](/configuration) for `session.dmScope` and other session options.

## API

### Generate Session Key

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

### Route Resolution

```typescript
import { resolveRoute } from '@xopcai/xopcbot/routing/index.js';

const route = resolveRoute({
  config,
  channel: 'telegram',
  accountId: 'default',
  peerKind: 'dm',
  peerId: '123456',
});

console.log(route.sessionKey); // e.g. main:telegram:default:dm:123456 (depends on dmScope)
console.log(route.agentId); // default agent when no binding matches (e.g. main)
```

## Related Files

- `src/routing/` - Routing system core
- `extensions/telegram/src/routing-integration.ts` - Telegram integration (workspace package `@xopcai/xopcbot-extension-telegram`)
- `src/acp/routing-integration.ts` - ACP integration
