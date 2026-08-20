import path from 'node:path';

import type { Config } from '../../../config/schema.js';
import {
  normalizeAgentId,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from '../../agent-scope.js';
import { resolveUserDir } from '../../../config/paths.js';
import type { DreamingResolvedConfig } from './config.js';
import { resolveDreamingConfig } from './config.js';

export type DreamingAgentScope = {
  agentId: string;
  workspaceDir: string;
  dreamingRoot: string;
  config: DreamingResolvedConfig;
  memory: Config['userContext']['memory'];
};

export function resolveDreamingRoot(): string {
  return path.join(resolveUserDir(), 'dreaming');
}

export function resolveDreamingAgentScope(config: Config, requestedAgentId?: string | null): DreamingAgentScope {
  const agentId = normalizeAgentId(requestedAgentId || resolveDefaultAgentId(config));
  return {
    agentId,
    workspaceDir: resolveAgentWorkspaceDir(config, agentId),
    dreamingRoot: resolveDreamingRoot(),
    config: resolveDreamingConfig(config, agentId),
    memory: config.userContext.memory,
  };
}
