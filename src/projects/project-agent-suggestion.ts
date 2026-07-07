import type { Config } from '../config/schema.js';
import { agentExists } from '../routing/resolve-route.js';
import { inferProjectKind, type ProjectKindInference } from './project-kind.js';

export const CODING_PROJECT_AGENT_ID = 'coder';

export function suggestProjectDefaultAgentId(input: {
  config: Config;
  kind: ProjectKindInference['kind'];
}): string | undefined {
  if (input.kind === 'coding' && agentExists(CODING_PROJECT_AGENT_ID, input.config)) {
    return CODING_PROJECT_AGENT_ID;
  }
  return undefined;
}

export function inferSuggestedProjectDefaultAgentId(input: {
  config: Config;
  name?: string | null;
  description?: string | null;
  workspaceRoot?: string | null;
  projectKind?: string | null;
}): string | undefined {
  const inferred = inferProjectKind(input);
  return suggestProjectDefaultAgentId({ config: input.config, kind: inferred.kind });
}
