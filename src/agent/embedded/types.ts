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
  | {
      /**
       * Mid-execution structured update for a tool whose `partialResult` is a
       * {@link AgentToolResult}-shaped object (i.e. it carries `details`).
       *
       * The runtime only emits this when the upstream tool actually called
       * `onUpdate` with structured details — so single-shot tools (read/write,
       * shell, …) never produce this event, but the workflow tool — which
       * pushes a fresh `WorkflowSnapshot` on every phase / agent state change
       * — produces a steady stream that the client wires straight into the
       * WorkflowCard's live progress tree.
       *
       * Carries `details` only (no `content` text) to keep the SSE payload
       * tight — the final `tool_end` event still ships the full envelope.
       */
      type: 'tool_update';
      toolName: string;
      toolCallId?: string;
      details: unknown;
    }
  | { type: 'message_end' }
  | { type: 'progress'; stage: string; message: string }
  | { type: 'error'; content: string }
  | {
      type: 'compaction';
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
};

export type RunXopcEmbeddedTurnResult = {
  ok: boolean;
  errorMessage?: string;
  lastAssistantText?: string;
};
