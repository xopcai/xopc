import type { AgentMessage, AgentToolResult, ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { AssistantMessageEvent, Model, Api, ImageContent } from '@earendil-works/pi-ai';

import type { SessionStore } from '../../session/store.js';

export type EmbeddedStreamEvent =
  | { type: 'agent_start'; runId?: string }
  | { type: 'agent_end'; runId?: string }
  | { type: 'message_start'; runId?: string; message: AgentMessage }
  | {
      type: 'message_update';
      runId?: string;
      message: AgentMessage;
      assistantMessageEvent?: AssistantMessageEvent;
    }
  | { type: 'message_end'; runId?: string; message: AgentMessage }
  | { type: 'tool_execution_start'; runId?: string; toolCallId: string; toolName: string; args: unknown }
  | {
      type: 'tool_execution_update';
      runId?: string;
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: AgentToolResult<any>;
    }
  | {
      type: 'tool_execution_end';
      runId?: string;
      toolCallId: string;
      toolName: string;
      result: AgentToolResult<any>;
      isError: boolean;
    }
  | { type: 'progress'; runId?: string; stage: string; message: string }
  | {
      type: 'memory_consent_required';
      runId?: string;
      requests: Array<{ id: string; recordId: string; statement: string; purpose: string }>;
    }
  | { type: 'memory_captured'; runId?: string; records: Array<{ id: string; content: string; kind: string }> }
  | { type: 'error'; runId?: string; content: string }
  | {
      type: 'compaction';
      runId?: string;
      status: 'started' | 'completed' | 'skipped';
      tokensBefore?: number;
      tokensAfter?: number;
      summary?: string;
    };

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
  /** Continue from the persisted trailing user row instead of appending it again. */
  resumeLastUserMessage?: boolean;
};

export type RunXopcEmbeddedTurnResult = {
  ok: boolean;
  errorMessage?: string;
  lastAssistantText?: string;
};
