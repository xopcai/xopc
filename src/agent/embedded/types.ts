import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent } from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Model, Api } from '@earendil-works/pi-ai';

import type { SessionStore } from '../../session/store.js';

export type EmbeddedStreamEvent =
  | { type: 'token'; content: string }
  | { type: 'thinking'; content?: string; status?: string }
  | {
      type: 'tool_start';
      toolName: string;
      toolCallId?: string;
      args?: Record<string, unknown>;
    }
  | {
      type: 'tool_end';
      toolName: string;
      toolCallId?: string;
      isError?: boolean;
      result?: unknown;
    }
  | { type: 'message_end' }
  | { type: 'progress'; stage: string; message: string }
  | { type: 'error'; content: string };

export type RunXopcEmbeddedTurnParams = {
  sessionKey: string;
  runId: string;
  userMessage: AgentMessage;
  model: Model<Api>;
  modelRef: string;
  tools: import('@earendil-works/pi-agent-core').AgentTool[];
  systemPrompt: string;
  thinkingLevel?: ThinkingLevel;
  workspaceDir: string;
  sessionStore: SessionStore;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  onEvent?: (event: EmbeddedStreamEvent) => void;
  images?: ImageContent[];
};

export type RunXopcEmbeddedTurnResult = {
  ok: boolean;
  errorMessage?: string;
  lastAssistantText?: string;
};
