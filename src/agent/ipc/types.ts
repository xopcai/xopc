// ============================================
// IPC Message Types
// ============================================

export type IPCMessageType = 'task' | 'query' | 'response' | 'event' | 'signal';
export type IPCPriority = 'low' | 'normal' | 'high';

export interface AgentIPCMessage {
  /** Message ID (UUID) */
  id: string;
  /** Message version */
  version: 1;
  /** Sender agent ID */
  from: string;
  /** Recipient agent ID */
  to: string;
  /** Message type */
  type: IPCMessageType;
  /** Message payload */
  payload: unknown;
  /** Reply to message ID */
  replyTo?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Creation timestamp (Unix ms) */
  createdAt: number;
  /** Expiration timestamp (Unix ms) */
  expiresAt?: number;
}

// ============================================
// Task Messages
// ============================================

export interface TaskPayload {
  /** Task description (natural language) */
  task: string;
  /** Additional context */
  context?: string;
  /** Task priority */
  priority?: IPCPriority;
  /** Associated session key */
  sessionKey?: string;
  /** Agent to receive result callback */
  callbackAgentId?: string;
}

export interface AgentTaskMessage extends AgentIPCMessage {
  type: 'task';
  payload: TaskPayload;
}

// ============================================
// Query Messages
// ============================================

export interface QueryPayload {
  /** Query description */
  query: string;
  /** Query type */
  queryType: string;
  /** Additional parameters */
  params?: Record<string, unknown>;
}

export interface AgentQueryMessage extends AgentIPCMessage {
  type: 'query';
  payload: QueryPayload;
}

// ============================================
// Response Messages
// ============================================

export interface ResponsePayload {
  /** Success status */
  success: boolean;
  /** Response data */
  data?: unknown;
  /** Error message if failed */
  error?: string;
  /** Original request ID */
  requestId: string;
}

export interface AgentResponseMessage extends AgentIPCMessage {
  type: 'response';
  payload: ResponsePayload;
}

// ============================================
// Event Messages
// ============================================

export interface EventPayload {
  /** Event type */
  event: string;
  /** Event data */
  data?: unknown;
  /** Source session */
  sessionKey?: string;
}

export interface AgentEventMessage extends AgentIPCMessage {
  type: 'event';
  payload: EventPayload;
}

// ============================================
// Signal Messages
// ============================================

export type AgentSignal = 'STOP' | 'PAUSE' | 'RESUME' | 'RELOAD' | 'STATUS';

export interface SignalPayload {
  /** Signal type */
  signal: AgentSignal;
  /** Optional signal data */
  data?: unknown;
}

export interface AgentSignalMessage extends AgentIPCMessage {
  type: 'signal';
  payload: SignalPayload;
}

// ============================================
// Utility Types
// ============================================

export type AnyIPCMessage =
  | AgentTaskMessage
  | AgentQueryMessage
  | AgentResponseMessage
  | AgentEventMessage
  | AgentSignalMessage;

export function isValidIPCMessage(msg: unknown): msg is AgentIPCMessage {
  if (typeof msg !== 'object' || msg === null) return false;

  const m = msg as Partial<AgentIPCMessage>;
  return (
    typeof m.id === 'string' &>
    typeof m.version === 'number' &>
    typeof m.from === 'string' &>
    typeof m.to === 'string' &>
    typeof m.type === 'string' &>
    ['task', 'query', 'response', 'event', 'signal'].includes(m.type) &>
    typeof m.createdAt === 'number'
  );
}

export function createTaskMessage(
  from: string,
  to: string,
  task: string,
  options: {
    context?: string;
    priority?: IPCPriority;
    sessionKey?: string;
    callbackAgentId?: string;
    timeoutMs?: number;
  } = {}
): AgentTaskMessage {
  return {
    id: generateMessageId(),
    version: 1,
    from,
    to,
    type: 'task',
    payload: {
      task,
      context: options.context,
      priority: options.priority || 'normal',
      sessionKey: options.sessionKey,
      callbackAgentId: options.callbackAgentId,
    },
    timeoutMs: options.timeoutMs,
    createdAt: Date.now(),
  };
}

export function createResponseMessage(
  from: string,
  to: string,
  requestId: string,
  success: boolean,
  data?: unknown,
  error?: string
): AgentResponseMessage {
  return {
    id: generateMessageId(),
    version: 1,
    from,
    to,
    type: 'response',
    payload: {
      success,
      data,
      error,
      requestId,
    },
    replyTo: requestId,
    createdAt: Date.now(),
  };
}

export function createSignalMessage(
  from: string,
  to: string,
  signal: AgentSignal,
  data?: unknown
): AgentSignalMessage {
  return {
    id: generateMessageId(),
    version: 1,
    from,
    to,
    type: 'signal',
    payload: {
      signal,
      data,
    },
    createdAt: Date.now(),
  };
}

function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
