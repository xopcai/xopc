import type { ToolCall } from '@earendil-works/pi-ai';

import type { ExternalAgentExecution, ExternalAgentKind } from '../../agent-config/schema.js';

export type ExternalRuntimeStatus = 'ready' | 'not_installed' | 'unauthenticated' | 'warning' | 'error';

export type ExternalRuntimeModelOption = {
  id: string;
  label: string;
  isDefault?: boolean;
};

export type ExternalRuntimeAccountInfo = {
  label?: string;
  authMode?: string;
};

export type ExternalRuntimeProbeResult = {
  kind: ExternalAgentKind;
  label: string;
  installed: boolean;
  status: ExternalRuntimeStatus;
  executablePath?: string;
  version?: string;
  account?: ExternalRuntimeAccountInfo;
  message?: string;
  hintCommand?: string;
  models: ExternalRuntimeModelOption[];
  checkedAt: number;
};

export type ExternalRuntimeAuthMode = 'browser' | 'device_code' | 'api_key';

export type ExternalRuntimeAuthPhase =
  | 'starting'
  | 'waiting'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type ExternalRuntimeAuthInputKind = 'code_or_url' | 'callback_url';

export type ExternalRuntimeAuthFlowSnapshot = {
  flowId: string;
  kind: ExternalAgentKind;
  mode: ExternalRuntimeAuthMode;
  phase: ExternalRuntimeAuthPhase;
  authorizationUrl?: string;
  userCode?: string;
  inputKind?: ExternalRuntimeAuthInputKind;
  message?: string;
  probe?: ExternalRuntimeProbeResult;
  expiresAt: string;
};

export type StartExternalRuntimeAuthInput = {
  execution: ExternalAgentExecution;
  mode?: ExternalRuntimeAuthMode;
  apiKey?: string;
};

export type ExternalRuntimeCapabilities = {
  /** Whether the runtime accepts file/image attachments or extra turn context refs. */
  supportsAttachments: boolean;
  /** Whether the external runtime manages its own model/thinking selection. */
  managesOwnModel: boolean;
  /** Whether the runtime requires a Project workspace on disk. */
  requiresWorkspace: boolean;
  /** Whether gateway principals must hold workspace.write scope. */
  requiresWorkspaceWrite: boolean;
};

export type ExternalSessionIdentity = {
  conversationId: string;
  transcriptId: string;
  runtimeKind: ExternalAgentKind;
  agentId: string;
  cwd: string;
};

export type ExternalSessionBinding = {
  transcriptId: string;
  runtimeKind: ExternalAgentKind;
  agentId: string;
  cwd: string;
  nativeSessionId: string;
  resumeCursor?: string;
  metadata?: Record<string, unknown>;
};

export type ExternalRuntimeToolCall = {
  /** Provider-native item/tool call id (unique within a turn). */
  id: string;
  /** Normalized xopc tool name (e.g. exec_command, apply_patch, web_search). */
  toolName: string;
  args: ToolCall['arguments'];
};

export type ExternalRuntimeToolResult = {
  id: string;
  isError: boolean;
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
};

export type ExternalRuntimeUsage = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
};

export type ExternalRuntimeEvent =
  | {
      type: 'session_bound';
      nativeSessionId: string;
      resumeCursor?: string;
      model?: string;
      metadata?: Record<string, unknown>;
      /** Set true when the runtime intentionally rotated its native session id (e.g. /clear). */
      rotated?: boolean;
    }
  | { type: 'text_delta'; itemId: string; delta: string }
  | { type: 'text_done'; itemId: string; text?: string }
  | { type: 'thinking_delta'; itemId: string; delta: string }
  | { type: 'tool_start'; tool: ExternalRuntimeToolCall }
  | { type: 'tool_output_delta'; id: string; delta: string; stream?: 'stdout' | 'stderr' }
  | { type: 'tool_end'; result: ExternalRuntimeToolResult }
  | { type: 'usage'; usage: ExternalRuntimeUsage }
  | { type: 'turn_done'; status: 'completed' | 'interrupted' | 'failed'; errorMessage?: string };

export interface ExternalDriverTurnContext {
  conversationId: string;
  transcriptId: string;
  agentId: string;
  execution: ExternalAgentExecution;
  runId: string;
  clientMessageId?: string;
  cwd: string;
  content: string;
  instructions?: string;
  existingBinding?: ExternalSessionBinding;
  signal: AbortSignal;
  emit: (event: ExternalRuntimeEvent) => void;
}

export interface ExternalAgentDriver {
  readonly kind: ExternalAgentKind;
  readonly label: string;
  readonly transcriptProvider: string;
  readonly transcriptApi: string;
  readonly defaultModelName: string;
  readonly capabilities: ExternalRuntimeCapabilities;
  runTurn(context: ExternalDriverTurnContext): Promise<void>;
  probe(execution?: ExternalAgentExecution): Promise<ExternalRuntimeProbeResult>;
}

export type ExternalTurnEvent = { type: string; [key: string]: unknown };

export interface RunExternalProjectTurnInput {
  conversationId: string;
  transcriptId: string;
  agentId: string;
  execution: ExternalAgentExecution;
  instructions?: string;
  content: string;
  hasAttachmentsOrContext: boolean;
  runId: string;
  clientMessageId?: string;
  signal: AbortSignal;
}
