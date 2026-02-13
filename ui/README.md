# @xopcbot/web-ui

Web UI components for xopcbot, providing chat and configuration interfaces.

## Features

- 💬 **Chat Interface** - Full-featured chat with streaming responses
- 🔧 **Configuration Dialog** - Form-based configuration editor
- 📎 **Attachments** - Image and file attachment support
- 🌐 **Gateway Integration** - WebSocket connection to remote gateway
- 🎨 **Theming** - Light/dark mode support
- 🌍 **i18n** - Multi-language support (English, Chinese)

## Installation

```bash
cd ui
pnpm install
```

## Development

```bash
pnpm run dev
```

## Building

```bash
pnpm run build
```

## Usage

### Basic Chat Component

```typescript
import { Agent } from '@mariozechner/pi-agent-core';
import { XopcbotChat } from '@xopcbot/web-ui';

const agent = new Agent({
  initialState: {
    systemPrompt: 'You are a helpful assistant.',
    model: /* your model */,
    tools: [],
    messages: [],
  },
});

const chat = document.querySelector('xopcbot-chat') as XopcbotChat;
chat.agent = agent;
```

### Gateway-Connected Chat

```typescript
import { XopcbotGatewayChat } from '@xopcbot/web-ui';

const chat = document.querySelector('xopcbot-gateway-chat') as XopcbotGatewayChat;
chat.config = {
  url: 'ws://localhost:3000/ws',
  token: 'optional-auth-token',
};
```

### Configuration Dialog

```typescript
import { XopcbotConfig, type ConfigSection } from '@xopcbot/web-ui';

const sections: ConfigSection[] = [
  {
    id: 'general',
    title: 'General',
    fields: [
      { key: 'language', label: 'Language', type: 'select', options: [
        { value: 'en', label: 'English' },
        { value: 'zh', label: '中文' },
      ]},
    ],
  },
];

const config = document.querySelector('xopcbot-config') as XopcbotConfig;
config.sections = sections;
config.onSave = (values) => {
  console.log('Saving configuration:', values);
};
```

## Components

| Component | Description |
|-----------|-------------|
| `xopcbot-chat` | Chat UI for local Agent instances |
| `xopcbot-gateway-chat` | Chat UI with WebSocket gateway connection |
| `xopcbot-config` | Configuration dialog |
| `message-editor` | Message input with attachments |
| `message-list` | Message display list |
| `streaming-message-container` | Streaming message display |

## Gateway Protocol

### Events (UI → Gateway)

| Event | Payload |
|-------|---------|
| `chat.send` | `{ message, attachments?, idempotencyKey }` |
| `chat.abort` | `{ sessionKey?, runId? }` |
| `chat.history` | `{ sessionKey, limit }` |
| `config.get` | `{}` |
| `config.set` | `{ raw, baseHash }` |

### Events (Gateway → UI)

| Event | Payload |
|-------|---------|
| `chat` | `{ runId, sessionKey, state, message?, errorMessage? }` |
| `config` | `{ raw, config, valid, issues }` |

## Styling

Customize using CSS variables:

```css
:root {
  --background: #ffffff;
  --foreground: #0f172a;
  --muted: #f1f5f9;
  --muted-foreground: #64748b;
  --primary: #3b82f6;
  --primary-foreground: #ffffff;
  --border: #e2e8f0;
  --radius: 0.5rem;
}
```

## Browser Support

- Chrome/Edge 88+
- Firefox 78+
- Safari 14+
- Any modern browser with Web Components support

## Dependencies

- `lit` - Web component library
- `@mariozechner/pi-agent-core` - Agent framework
- `@mariozechner/pi-ai` - AI providers

## License

MIT
