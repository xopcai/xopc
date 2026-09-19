import type {
  AgentToolResult,
  AgentToolUpdateCallback,
} from '@earendil-works/pi-agent-core';
import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';

export const EXTERNAL_TOOL_SOURCES = ['cli', 'mcp', 'composio', 'extension', 'memory', 'endpoint'] as const;

export type ExternalToolSource = (typeof EXTERNAL_TOOL_SOURCES)[number];

export interface ExternalToolSearchHit {
  toolRef: string;
  source: ExternalToolSource;
  namespace: string;
  title: string;
  summary: string;
}

export interface ExternalToolDescriptor extends ExternalToolSearchHit {
  description: string;
  inputSchema: Record<string, unknown>;
  /** Host-curated contract; never copied from remote readOnlyHint annotations. */
  batchRead?: boolean;
}

export interface VersionedExternalToolDescriptor extends ExternalToolDescriptor {
  revision: string;
}

export interface ExternalToolExecutionContext {
  toolCallId: string;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<Record<string, unknown>>;
}

export interface ExternalToolTurnContext {
  channel: string;
  chatId: string;
  conversationId: string;
  origin: TurnOrigin;
}

export interface ExternalToolProvider {
  readonly source: ExternalToolSource;
  search(query: string): Promise<ExternalToolSearchHit[]>;
  describe(toolRef: string): Promise<ExternalToolDescriptor | undefined>;
  execute(
    toolRef: string,
    args: Record<string, unknown>,
    approvalId: string | undefined,
    context: ExternalToolExecutionContext,
  ): Promise<AgentToolResult<Record<string, unknown>>>;
}
