import type { AgentTool } from '@earendil-works/pi-agent-core';

export type ToolMutationScope = 'none' | 'workspace' | 'external' | 'unknown';

export type ToolVerificationKind = 'none' | 'diff-review' | 'test' | 'build' | 'lint' | 'typecheck';

export interface XopcToolMetadata {
  mutatesWorkspace?: boolean;
  mutationScope?: ToolMutationScope;
  supportsParallel?: boolean;
  idempotent?: boolean;
  verificationKind?: ToolVerificationKind;
  requiresExclusiveWorkspaceLock?: boolean;
  finalGuardRelevant?: boolean;
}

export type AgentToolWithMetadata<TParams = any, TDetails = any> = AgentTool<TParams, TDetails> & XopcToolMetadata;

export const DEFAULT_TOOL_METADATA: Required<XopcToolMetadata> = {
  mutatesWorkspace: false,
  mutationScope: 'none',
  supportsParallel: false,
  idempotent: false,
  verificationKind: 'none',
  requiresExclusiveWorkspaceLock: false,
  finalGuardRelevant: false,
};

export function getToolMetadata(tool: AgentTool<any, any>): Required<XopcToolMetadata> {
  const t = tool as AgentToolWithMetadata;
  return {
    mutatesWorkspace: t.mutatesWorkspace === true,
    mutationScope: t.mutationScope ?? DEFAULT_TOOL_METADATA.mutationScope,
    supportsParallel: t.supportsParallel === true,
    idempotent: t.idempotent === true,
    verificationKind: t.verificationKind ?? DEFAULT_TOOL_METADATA.verificationKind,
    requiresExclusiveWorkspaceLock: t.requiresExclusiveWorkspaceLock === true,
    finalGuardRelevant: t.finalGuardRelevant === true,
  };
}
