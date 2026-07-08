import path from 'node:path';

import type { Config } from '../../../config/schema.js';
import {
  normalizeAgentId,
  resolveAgentHomeDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from '../../agent-scope.js';
import { resolveEffectiveAgentManifestForAgent } from '../../../config/agent-profile.js';
import type { DreamingResolvedConfig } from './config.js';
import { resolveDreamingConfig } from './config.js';

export type DreamingAgentScope = {
  agentId: string;
  workspaceDir: string;
  memoriesDir: string;
  memoryPath: string;
  dreamsPath: string;
  config: DreamingResolvedConfig;
  memory: ReturnType<typeof resolveEffectiveAgentManifestForAgent>['memory'];
};

export function resolveDreamingRootForAgent(config: Config, agentId: string): string {
  return path.join(resolveAgentHomeDir(config, agentId), 'memories');
}

export function resolveDreamingAgentScope(config: Config, requestedAgentId?: string | null): DreamingAgentScope {
  const agentId = normalizeAgentId(requestedAgentId || resolveDefaultAgentId(config));
  const manifest = resolveEffectiveAgentManifestForAgent(config, agentId);
  const memoriesDir = resolveDreamingRootForAgent(config, agentId);
  return {
    agentId,
    workspaceDir: resolveAgentWorkspaceDir(config, agentId),
    memoriesDir,
    memoryPath: path.join(memoriesDir, 'MEMORY.md'),
    dreamsPath: path.join(memoriesDir, 'DREAMS.md'),
    config: resolveDreamingConfig(config, agentId),
    memory: manifest.memory,
  };
}
