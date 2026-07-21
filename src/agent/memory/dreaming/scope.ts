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
  memoriesDir: string;
  memoryPath: string;
  dreamsPath: string;
  config: DreamingResolvedConfig;
  memory: Config['userContext']['memory'];
};

export function resolveDreamingRoot(): string {
  return path.join(resolveUserDir(), 'memories');
}

export function resolveDreamingAgentScope(config: Config, requestedAgentId?: string | null): DreamingAgentScope {
  const agentId = normalizeAgentId(requestedAgentId || resolveDefaultAgentId(config));
  const memoriesDir = resolveDreamingRoot();
  return {
    agentId,
    workspaceDir: resolveAgentWorkspaceDir(config, agentId),
    memoriesDir,
    memoryPath: path.join(memoriesDir, 'MEMORY.md'),
    dreamsPath: path.join(memoriesDir, 'DREAMS.md'),
    config: resolveDreamingConfig(config, agentId),
    memory: config.userContext.memory,
  };
}
