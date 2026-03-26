# Agent Control Protocol (ACP)

> ACP is a runtime abstraction layer that provides unified session lifecycle management for agent runtimes.

## Overview

The Agent Control Protocol (ACP) enables xopcbot to work with different agent runtimes through a common interface. It handles:

- **Session lifecycle**: Create, resume, and close agent sessions
- **Turn execution**: Send messages and receive streaming responses
- **State management**: Persist session metadata and runtime options
- **Resource management**: Cache runtime handles with TTL-based eviction
- **Concurrency control**: Serialize operations per session

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AcpSessionManager                         │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ TurnManager │  │RuntimeCacheMgr  │  │LifecycleManager │  │
│  │             │  │                 │  │                 │  │
│  │ • execute   │  │ • ensureHandle  │  │ • resolve       │  │
│  │ • cancel    │  │ • evictIdle     │  │ • initialize    │  │
│  │ • latency   │  │ • getStats      │  │ • close         │  │
│  └──────┬──────┘  └────────┬────────┘  └────────┬────────┘  │
└─────────┼──────────────────┼────────────────────┼───────────┘
          │                  │                    │
          └──────────────────┼────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────┐
│                  SessionActorQueue                         │
│            (Serialized per-session operations)             │
└────────────────────────────┬──────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────┐
│                  AcpRuntime Backend                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  codex   │  │  claude  │  │  openai  │  │  custom  │  │
│  │  (acpx)  │  │   code   │  │  agents  │  │  runtime │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Runtime Layer (`src/acp/runtime/`)

The runtime layer defines the interface that all ACP backends must implement.

#### AcpRuntime Interface

```typescript
export interface AcpRuntime {
  /** Ensure session exists (create or resume) */
  ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle>;

  /** Run a turn and return streaming events */
  runTurn(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent>;

  /** Cancel current operation */
  cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void>;

  /** Close session */
  close(input: { handle: AcpRuntimeHandle; reason: string }): Promise<void>;

  /** Optional: Get runtime capabilities */
  getCapabilities?(input: { handle?: AcpRuntimeHandle }): Promise<AcpRuntimeCapabilities>;

  /** Optional: Get runtime status */
  getStatus?(input: { handle: AcpRuntimeHandle }): Promise<AcpRuntimeStatus>;

  /** Optional: Set runtime mode */
  setMode?(input: { handle: AcpRuntimeHandle; mode: string }): Promise<void>;

  /** Optional: Set config option */
  setConfigOption?(input: { handle: AcpRuntimeHandle; key: string; value: string }): Promise<void>;

  /** Optional: Run diagnostics */
  doctor?(): Promise<AcpRuntimeDoctorReport>;
}
```

#### Session Identity

ACP uses a 3-layer identity system to track sessions across different systems:

```typescript
type SessionIdentity = {
  state: "resolved" | "pending";
  source: "ensure" | "status" | "event";
  acpxRecordId?: string;      // Backend-local record ID
  acpxSessionId?: string;     // Backend-level session ID
  agentSessionId?: string;    // Upstream agent session ID
  lastUpdatedAt: number;
};
```

### 2. Control Plane (`src/acp/control-plane/`)

The control plane manages session lifecycle and coordinates between components.

#### TurnManager

Manages turn execution and cancellation:

```typescript
class TurnManager {
  executeTurn(params: {
    input: AcpRunTurnInput;
    runtime: { runtime: AcpRuntime; handle: AcpRuntimeHandle; meta: SessionAcpMeta };
    onStateChange: (state: SessionState, lastError?: string) => Promise<void>;
  }): Promise<void>;

  cancelTurn(params: {
    sessionKey: string;
    runtime: { runtime: AcpRuntime; handle: AcpRuntimeHandle };
    reason?: string;
  }): Promise<boolean>;

  getLatencyStats(): TurnLatencyStats;
}
```

#### RuntimeCacheManager

Manages runtime handle caching with TTL eviction:

```typescript
class RuntimeCacheManager {
  ensureHandle(params: {
    cfg: Config;
    sessionKey: string;
    meta: SessionAcpMeta;
  }): Promise<{ runtime: AcpRuntime; handle: AcpRuntimeHandle; meta: SessionAcpMeta }>;

  evictIdle(params: {
    cfg: Config;
    hasActiveTurn: (sessionKey: string) => boolean;
    onEvict: (state: CachedRuntimeState) => Promise<void>;
  }): Promise<void>;
}
```

#### SessionLifecycleManager

Manages session lifecycle operations:

```typescript
class SessionLifecycleManager {
  resolveSession(params: {
    sessionKey: string;
    getCachedMeta: (key: string) => SessionAcpMeta | null;
  }): Promise<AcpSessionResolution>;

  initializeSession(params: {
    input: AcpInitializeSessionInput;
    onRuntimeCreated: (sessionKey: string, runtime: RuntimeInfo) => Promise<void>;
  }): Promise<{ runtime: AcpRuntime; meta: SessionAcpMeta }>;

  closeSession(params: CloseSessionParams): Promise<AcpCloseSessionResult>;

  setSessionState(params: SetStateParams): Promise<void>;
}
```

### 3. Session Actor Queue

Ensures serialized access to each session:

```typescript
class SessionActorQueue {
  run<T>(actorKey: string, op: () => Promise<T>): Promise<T>;
}
```

Each session has its own actor queue, preventing race conditions while allowing parallel operations across different sessions.

## Session Modes

ACP supports two session modes:

### Persistent Mode

Sessions remain active across turns:

```typescript
{
  mode: "persistent",
  // Session stays open until explicitly closed
  // Supports multi-turn conversations
  // State is preserved between turns
}
```

### Oneshot Mode

Sessions auto-close after each turn:

```typescript
{
  mode: "oneshot",
  // Session closes automatically after turn completes
  // Suitable for single-turn tasks
  // No state preservation between turns
}
```

## Configuration

Add ACP configuration to your `config.json`:

```json
{
  "acp": {
    "enabled": true,
    "backend": "acpx",
    "defaultAgent": "main",
    "maxConcurrentSessions": 5,
    "dispatch": {
      "enabled": true
    },
    "stream": {
      "coalesceIdleMs": 100,
      "maxChunkChars": 4000,
      "deliveryMode": "live"
    },
    "runtime": {
      "ttlMinutes": 30,
      "installCommand": "npm install -g @acpx/cli"
    }
  }
}
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `enabled` | `boolean` | Master switch for ACP |
| `backend` | `string` | Default backend ID to use |
| `defaultAgent` | `string` | Default agent for new sessions |
| `maxConcurrentSessions` | `number` | Maximum concurrent sessions |
| `dispatch.enabled` | `boolean` | Enable turn dispatch |
| `stream.coalesceIdleMs` | `number` | Stream coalescing window |
| `stream.maxChunkChars` | `number` | Max characters per chunk |
| `stream.deliveryMode` | `"live" \| "final_only"` | Delivery mode |
| `runtime.ttlMinutes` | `number` | Idle session TTL in minutes |
| `runtime.installCommand` | `string` | Install command for `doctor` |

## Implementing a Custom Backend

To create a custom ACP runtime backend:

### 1. Implement the AcpRuntime Interface

```typescript
import type { AcpRuntime, AcpRuntimeHandle, AcpRuntimeEvent } from "xopcbot/acp";

export class MyCustomRuntime implements AcpRuntime {
  async ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle> {
    // Create or resume a session in your runtime
    return {
      sessionKey: input.sessionKey,
      backend: "my-backend",
      runtimeSessionName: `session-${generateId()}`,
      backendSessionId: await this.runtime.createSession(input),
    };
  }

  async *runTurn(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent> {
    const { handle, text, mode, requestId, signal } = input;

    // Send message to your runtime
    const stream = await this.runtime.sendMessage(handle.backendSessionId, text);

    for await (const chunk of stream) {
      // Check for abort
      if (signal?.aborted) {
        throw new Error("Aborted");
      }

      // Yield text delta
      yield { type: "text_delta", text: chunk.content };

      // Yield tool calls if supported
      if (chunk.toolCall) {
        yield {
          type: "tool_call",
          text: chunk.toolCall.name,
          toolCallId: chunk.toolCall.id,
        };
      }
    }

    // Signal completion
    yield { type: "done" };
  }

  async cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void> {
    await this.runtime.cancel(input.handle.backendSessionId);
  }

  async close(input: { handle: AcpRuntimeHandle; reason: string }): Promise<void> {
    await this.runtime.closeSession(input.handle.backendSessionId);
  }

  async getCapabilities(): Promise<AcpRuntimeCapabilities> {
    return {
      controls: ["session/set_mode", "session/set_config_option"],
      configOptionKeys: ["temperature", "maxTokens"],
    };
  }

  async doctor(): Promise<AcpRuntimeDoctorReport> {
    const isHealthy = await this.runtime.checkHealth();
    return {
      ok: isHealthy,
      message: isHealthy ? "Runtime is healthy" : "Runtime is not responding",
      installCommand: "npm install -g my-runtime",
    };
  }
}
```

### 2. Register Your Backend

```typescript
import { registerAcpRuntimeBackend } from "xopcbot/acp";

const runtime = new MyCustomRuntime();

registerAcpRuntimeBackend({
  id: "my-backend",
  runtime,
  healthy: () => runtime.isConnected(),
});
```

### 3. Use Your Backend

```bash
# Via CLI
xopcbot acp status
xopcbot acp doctor

# Via config
{
  "acp": {
    "backend": "my-backend"
  }
}
```

## CLI Commands

### Status

```bash
# Show global status
xopcbot acp status

# Show specific session status
xopcbot acp status -s <session-key>

# JSON output
xopcbot acp status --json
```

### Doctor

```bash
# Run diagnostics on all backends
xopcbot acp doctor
```

### Runtime Mode

```bash
# Set runtime mode
xopcbot acp set-mode <mode> -s <session-key>
```

### Config Options

```bash
# Set config option
xopcbot acp set-config <key> <value> -s <session-key>
```

### Session Management

```bash
# List sessions
xopcbot acp list

# Close session
xopcbot acp close -s <session-key>

# Cancel active turn
xopcbot acp cancel -s <session-key>
```

## Error Handling

ACP uses standardized error codes:

| Code | Description | Retryable |
|------|-------------|-----------|
| `ACP_SESSION_INIT_FAILED` | Failed to initialize session | No |
| `ACP_TURN_FAILED` | Turn execution failed | Yes |
| `ACP_BACKEND_MISSING` | No backend registered | No |
| `ACP_BACKEND_UNAVAILABLE` | Backend temporarily unavailable | Yes |
| `ACP_BACKEND_UNSUPPORTED_CONTROL` | Control not supported by backend | No |

## Observability

Get runtime metrics via `getObservabilitySnapshot()`:

```typescript
{
  runtimeCache: {
    activeSessions: 5,
    idleTtlMs: 1800000,
    evictedTotal: 12,
    lastEvictedAt: 1773466677846,
  },
  turns: {
    active: 3,
    queueDepth: 0,
    completed: 150,
    failed: 5,
    averageLatencyMs: 2450,
    maxLatencyMs: 15000,
  },
  errorsByCode: {
    ACP_TURN_FAILED: 3,
    ACP_BACKEND_UNAVAILABLE: 2,
  },
}
```

## Best Practices

1. **Always handle abort signals** in `runTurn()` to support cancellation
2. **Implement `doctor()`** for better debugging experience
3. **Use `getCapabilities()`** to advertise supported controls
4. **Set appropriate TTL** based on your use case
5. **Handle identity reconciliation** for resilient session recovery

## See Also

- [Source: `src/acp/`](https://github.com/xopcai/xopcbot/tree/main/src/acp) — runtime, control plane, types
- [CLI `acp` commands](https://github.com/xopcai/xopcbot/tree/main/src/cli/commands/acp) — command implementations
- [Session routing](/routing-system) — how ACP integrates with session keys
