import type {
  AgentToolResult,
  AgentToolUpdateCallback,
} from '@earendil-works/pi-agent-core';

export const EXTERNAL_TOOL_SOURCES = ['mcp', 'composio', 'extension', 'memory'] as const;

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
}

export interface VersionedExternalToolDescriptor extends ExternalToolDescriptor {
  revision: string;
}

export interface ExternalToolExecutionContext {
  toolCallId: string;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<Record<string, unknown>>;
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
