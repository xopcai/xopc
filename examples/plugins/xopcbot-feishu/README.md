# Xopcbot Feishu Plugin

Feishu/Lark (飞书) channel plugin for xopcbot with WebSocket-based messaging.

## Features

- ✅ **WebSocket Connection** - Real-time event receiving without public URL
- ✅ **Bidirectional Messaging** - Send and receive text messages
- ✅ **Media Support** - Handle images, files, audio, video, and stickers
- ✅ **Session Routing** - Automatic session management for DMs and groups
- ✅ **Policy Control** - Allowlist and policy management for access control
- ✅ **Group Chat** - Support for @mention and group policies
- ✅ **Thread/Topic Support** - Session isolation for threaded conversations

## Installation

```bash
# From local path
xopcbot plugin install ./examples/plugins/xopcbot-feishu

# Or copy to workspace
xopcbot plugin install /path/to/xopcbot-feishu
```

## Configuration

Add to your `config.json`:

```json
{
  "plugins": {
    "enabled": ["xopcbot-feishu"],
    "xopcbot-feishu": {
      "enabled": true,
      "appId": "cli_xxxxxxxxxx",
      "appSecret": "your-app-secret",
      "domain": "feishu",
      "dmPolicy": "pairing",
      "groupPolicy": "allowlist",
      "allowFrom": [],
      "groupAllowFrom": [],
      "requireMention": true,
      "mediaMaxMb": 30
    }
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | false | Enable the Feishu channel |
| `appId` | string | - | Feishu app ID (cli_xxxxxxxx) |
| `appSecret` | string | - | Feishu app secret |
| `domain` | string | "feishu" | Domain: "feishu" (China) or "lark" (International) |
| `dmPolicy` | string | "pairing" | DM policy: "open", "pairing", "allowlist" |
| `groupPolicy` | string | "allowlist" | Group policy: "open", "allowlist", "disabled" |
| `allowFrom` | string[] | [] | Allowed user OpenIDs for DM |
| `groupAllowFrom` | string[] | [] | Allowed chat IDs for groups |
| `requireMention` | boolean | true | Require @mention in groups |
| `mediaMaxMb` | number | 30 | Max media size in MB |

## Feishu App Setup

1. Go to [Feishu Open Platform](https://open.feishu.cn) (or [Lark](https://open.larksuite.com) for international)
2. Create a new "Custom App" (自建应用)
3. Get **App ID** and **App Secret** from the Credentials page
4. Enable required permissions (see below)
5. Configure **Event Subscription**: Select "Long Connection" (使用长连接接收事件)
6. Add event subscriptions:
   - `im.message.receive_v1` - Receive messages
   - `im.chat.member.bot.added_v1` - Bot added to group
   - `im.chat.member.bot.deleted_v1` - Bot removed from group
7. Publish the app (at least to test version)

### Required Permissions

| Permission | Scope | Description |
|------------|-------|-------------|
| `im:message` | Messaging | Send and receive messages |
| `im:message.p2p_msg:readonly` | DM | Read direct messages to bot |
| `im:message.group_at_msg:readonly` | Group | Receive @mention messages in groups |
| `im:message:send_as_bot` | Send | Send messages as the bot |
| `im:resource` | Media | Upload and download images/files |

### Optional Permissions

| Permission | Description |
|------------|-------------|
| `contact:user.base:readonly` | Get user basic info (for display names) |
| `im:message:readonly` | Get message history |
| `im:message:update` | Update/edit sent messages |
| `im:message:recall` | Recall sent messages |

## Usage

### Command Line

```bash
# Send a message via Feishu
/feishu <chat_id> Hello, this is a test message
```

### Agent Tool

Agents can use the `feishu_send` tool:

```
feishu_send(to="chat_xxxxxxxx", message="Hello from agent!")
```

### Session Routing

Sessions are automatically routed based on:

- **Direct Messages**: `feishu:dm:{user_open_id}`
- **Group Chats**: `feishu:group:{chat_id}`
- **Threads**: `feishu:group:{chat_id}:topic:{root_id}`

### Policies

#### DM Policies

- **open**: Accept messages from any user
- **pairing**: Accept messages after pairing/approval (default)
- **allowlist**: Only accept from users in `allowFrom` list

#### Group Policies

- **open**: Accept messages from any group (with @mention)
- **allowlist**: Only accept from chats in `groupAllowFrom` list
- **disabled**: Disable group chat functionality

## Architecture

```
Feishu WebSocket
       ↓
Event Dispatcher
       ↓
Message Parser
       ↓
Policy Check → Rejected?
       ↓
Media Download (if any)
       ↓
Session Router
       ↓
Agent Session
       ↓
Response → Feishu API
```

## File Structure

```
xopcbot-feishu/
├── index.ts          # Plugin entry point
├── src/
│   ├── types.ts      # TypeScript types
│   ├── client.ts     # Feishu SDK wrapper
│   ├── channel.ts    # Channel implementation
│   ├── parser.ts     # Message parsing
│   ├── policy.ts     # Access control
│   ├── send.ts       # Message sending
│   └── media.ts      # Media handling
├── xopcbot.plugin.json  # Plugin manifest
└── package.json      # Dependencies
```

## Troubleshooting

### Bot cannot receive messages

1. Check event subscription mode is set to "Long Connection"
2. Ensure `im.message.receive_v1` event is subscribed
3. Verify permissions are approved
4. Check app is published

### 403 errors when sending

Ensure `im:message:send_as_bot` permission is approved.

### Cannot find bot in Feishu

1. Ensure app is published (at least to test version)
2. Check your account is in the app's availability scope
3. Search for the bot name in Feishu

## License

MIT

## Credits

Inspired by [clawdbot-feishu](https://github.com/m1heng/clawdbot-feishu) for OpenClaw.
