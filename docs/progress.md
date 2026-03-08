# Progress Feedback

> Real-time progress feedback for long-running agent tasks

## Overview

The Progress Feedback system provides real-time updates to users during long-running agent tasks. It helps users understand what the agent is doing, reducing the perception of "stuck" or "no response" during complex operations.

## Features

### 1. Tool Execution Feedback

When the agent executes tools (read, write, bash, search, etc.), users receive real-time status updates:

| Stage | Emoji | Description |
|-------|-------|-------------|
| thinking | 🤔 | AI is reasoning/thinking |
| searching | 🔍 | Web search or grep operations |
| reading | 📖 | Reading files from disk |
| writing | ✍️ | Writing or editing files |
| executing | ⚙️ | Running shell commands |
| analyzing | 📊 | Analyzing data |

### 2. Progress Stages

The system automatically maps tool names to appropriate progress stages:

```
Tool Name          → Stage
────────────────────────────
read_file          → reading
glob               → reading  
grep               → searching
web_search         → searching
bash               → executing
write_file         → writing
edit               → writing
```

### 3. Long-running Task Heartbeat

For tasks that take longer than 30 seconds, the system sends periodic heartbeat messages:

```
🔍 搜索中...
⏱️ 已进行 45 秒
```

Heartbeat is sent every 20 seconds after the 30-second threshold.

### 4. Stream Integration

For Telegram channels, progress indicators are displayed inline with streaming messages:

```
🔍 搜索中

正在搜索: "how to build a react app"
```

## Configuration

### Feedback Levels

You can configure the feedback verbosity in the progress manager:

```typescript
const config = {
  // Feedback level: minimal | normal | verbose
  level: 'normal',
  
  // Show thinking/reasoning updates
  showThinking: true,
  
  // Stream tool progress in real-time
  streamToolProgress: true,
  
  // Enable heartbeat for long tasks
  heartbeatEnabled: true,
  
  // Heartbeat interval in milliseconds
  heartbeatIntervalMs: 20000,
  
  // Threshold for "long task" in milliseconds
  longTaskThresholdMs: 30000,
};
```

### Telegram Stream Mode

Configure stream behavior in `config.json`:

```json
{
  "channels": {
    "telegram": {
      "accounts": {
        "default": {
          "streamMode": "partial"
        }
      }
    }
  }
}
```

| Mode | Description |
|------|-------------|
| `off` | No streaming, send complete message at once |
| `partial` | Stream AI response, show progress indicator for tools |
| `block` | Full streaming with all intermediate updates |

## How It Works

### Event Flow

```
User Message
    ↓
Agent Processing
    ↓
┌─────────────────────────────────────────────┐
│ 1. tool_execution_start                     │
│    → Set progress stage on stream           │
│    → Show "🔍 搜索中" indicator             │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ 2. tool_execution_update                    │
│    → (Optional) Stream partial results      │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ 3. tool_execution_end                       │
│    → Clear progress indicator               │
│    → Send final response                    │
└─────────────────────────────────────────────┘
    ↓
Task Complete
```

### Key Components

| Component | File | Description |
|-----------|------|-------------|
| `ProgressFeedbackManager` | `src/agent/progress.ts` | Core progress tracking and callbacks |
| `DraftStream` | `src/channels/draft-stream.ts` | Telegram message streaming with progress |
| `AgentService` | `src/agent/service.ts` | Integrates progress with agent events |

## API Reference

### ProgressFeedbackManager

```typescript
import { ProgressFeedbackManager, progressFeedbackManager } from './agent/progress';

const manager = new ProgressFeedbackManager({
  level: 'normal',
  showThinking: true,
  streamToolProgress: true,
  heartbeatEnabled: true,
});

// Set callbacks for progress events
manager.setCallbacks({
  onProgress: (msg) => console.log(msg),
  onStreamStart: (toolName, args) => console.log(`Starting: ${toolName}`),
  onStreamEnd: (toolName, result, isError) => console.log(`Ended: ${toolName}`),
  onHeartbeat: (elapsed, stage) => console.log(`Still working... ${elapsed}ms`),
});

// Trigger progress updates
manager.startTask();
manager.onToolStart('read_file', { path: '/some/file.txt' });
manager.onToolEnd('read_file', { content: '...' });
manager.endTask();
```

### ProgressMessage

```typescript
interface ProgressMessage {
  type: 'start' | 'update' | 'complete' | 'error' | 'thinking';
  stage: ProgressStage;
  message: string;
  detail?: string;
  toolName?: string;
}

type ProgressStage = 'thinking' | 'searching' | 'reading' | 'writing' | 'executing' | 'analyzing' | 'idle';
```

## Troubleshooting

### No Progress Updates

1. **Check stream mode**: Ensure `streamMode` is set to `partial` or `block` in config
2. **Check logs**: Look for `ProgressFeedback` or `DraftStream` logs
3. **Check channel support**: Progress updates only work with Telegram (currently)

### Too Many Updates

Reduce feedback verbosity:

```typescript
const manager = new ProgressFeedbackManager({
  level: 'minimal',  // Only show errors
  streamToolProgress: false,  // Don't stream tool updates
  heartbeatEnabled: false,  // Disable heartbeats
});
```

## Related

- [Channels](channels.md) - Telegram channel configuration
- [Architecture](architecture.md) - System architecture overview
