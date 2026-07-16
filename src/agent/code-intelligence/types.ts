export type CodeIntelligenceState =
  | 'idle'
  | 'connecting'
  | 'indexing'
  | 'ready'
  | 'dirty'
  | 'degraded'
  | 'unavailable'
  | 'disposed';

export interface CodeIntelligenceStatus {
  state: CodeIntelligenceState;
  workspace: string;
  project: string;
  indexedAt?: string;
  dirtyPaths: string[];
  coverage: 'complete' | 'partial' | 'unknown';
  errorMessage?: string;
}

export interface CodeIntelligenceToolResult {
  text: string;
  status: CodeIntelligenceStatus;
}

export interface CodeIntelligenceRuntimeLike {
  prime(): Promise<void>;
  markDirty(paths: readonly string[]): void;
  supportsTool(name: string): boolean;
  callTool(
    toolNames: string | readonly string[],
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CodeIntelligenceToolResult>;
  getStatus(): CodeIntelligenceStatus;
  dispose(): Promise<void>;
}
