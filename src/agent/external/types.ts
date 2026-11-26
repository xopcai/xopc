import type { ToolCall } from '@earendil-works/pi-ai';
import type { ModelThinkingCapabilities } from '@xopcai/gateway-contract';

import type {
  ExternalAgentExecution,
  ExternalAgentKind,
  ExternalPermissionMode,
} from '../../agent-config/schema.js';
import type { SessionInteractionPolicy } from '../session/interaction-policy-state.js';
import type { TurnPlanStep } from '../tools/update-plan-tool.js';
import type { UserTurnAttachment } from '../../gateway/user-turn-input.js';

export type ExternalRuntimeStatus = 'ready' | 'not_installed' | 'unauthenticated' | 'warning' | 'error';

export type ExternalRuntimeModelOption = {
  id: string;
  label: string;
  isDefault?: boolean;
  /** Normalized thinking/reasoning capabilities for the chat effort slider. */
  thinking?: ModelThinkingCapabilities;
  /** Optional protocol-native config id for thinking effort (e.g. ACP `thought_level` / `effort`). */
  thinkingConfigId?: string;
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

export type ExternalSteeringMode = 'native' | 'interrupt_restart';

export type ExternalRuntimeCapabilities = {
  /** Whether the runtime accepts file/image attachments or extra turn context refs. */
  supportsAttachments: boolean;
  /** Whether the external runtime manages its own model/thinking selection. */
  managesOwnModel: boolean;
  /** Whether the runtime requires a Project workspace on disk. */
  requiresWorkspace: boolean;
  /** Whether gateway principals must hold workspace.write scope. */
  requiresWorkspaceWrite: boolean;
  /** How mid-turn steering is executed: native RPC (Codex turn/steer) or cancel-and-resume (ACP). */
  steeringMode?: ExternalSteeringMode;
};

export type ExternalTurnSteerInput = {
  content: string;
  attachments: ExternalTurnAttachment[];
  clientMessageId?: string;
};

export type ExternalTurnSteerHandler = (input: ExternalTurnSteerInput) => Promise<void>;

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
  | { type: 'thinking_done'; itemId: string; text?: string }
  | { type: 'tool_start'; tool: ExternalRuntimeToolCall }
  | { type: 'tool_update'; tool: ExternalRuntimeToolCall }
  | { type: 'tool_output_delta'; id: string; delta: string; stream?: 'stdout' | 'stderr' }
  | { type: 'tool_end'; result: ExternalRuntimeToolResult }
  | { type: 'plan_updated'; explanation?: string; steps: TurnPlanStep[] }
  | { type: 'title_updated'; title: string }
  | { type: 'usage'; usage: ExternalRuntimeUsage }
  | { type: 'turn_done'; status: 'completed' | 'interrupted' | 'failed'; errorMessage?: string };

export type ExternalTurnAttachment = {
  type: 'image' | 'file';
  name?: string;
  mimeType?: string;
  localPath?: string;
  base64?: string;
  workspaceRelativePath?: string;
};

export type ExternalInteractionChoice = {
  id: string;
  label: string;
  description?: string;
};

export type ExternalInteractionRequest =
  | {
      kind: 'approval';
      title?: string;
      question: string;
      detail?: string;
      actionKind?: 'command' | 'file_change' | 'other';
    }
  | {
      kind: 'question';
      title?: string;
      question: string;
      choices?: ExternalInteractionChoice[];
      allowFreeText?: boolean;
    };

export type ExternalInteractionResponse =
  | { kind: 'approval'; decision: 'approve' | 'deny' }
  | { kind: 'question'; choiceId?: string; text?: string; cancelled?: boolean };

export interface ExternalDriverTurnContext {
  conversationId: string;
  transcriptId: string;
  agentId: string;
  execution: ExternalAgentExecution;
  permissionMode: ExternalPermissionMode;
  sessionPolicy: SessionInteractionPolicy;
  /** Per-session model override chosen in chat (takes precedence over execution.model). */
  modelOverride?: string;
  /** Per-session thinking / reasoning effort level chosen in chat. */
  thinkingLevel?: string;
  runId: string;
  clientMessageId?: string;
  cwd: string;
  content: string;
  attachments: ExternalTurnAttachment[];
  instructions?: string;
  existingBinding?: ExternalSessionBinding;
  signal: AbortSignal;
  emit: (event: ExternalRuntimeEvent) => void;
  requestInteraction: (request: ExternalInteractionRequest) => Promise<ExternalInteractionResponse>;
  /** Optional hook for drivers that support native mid-turn steering (e.g. Codex turn/steer). */
  registerSteerHandler?: (handler: ExternalTurnSteerHandler | null) => void;
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
  modelOverride?: string;
  thinkingLevel?: string;
  onTitleUpdated?: (title: string) => void;
  content: string;
  attachments?: UserTurnAttachment[];
  hasAttachmentsOrContext: boolean;
  runId: string;
  clientMessageId?: string;
  signal: AbortSignal;
}
