import { describe, expect, it } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { resolveProjectAgentId } from '../project-agent.js';
import type { ProjectService } from '../project-service.js';

function config() {
  initializeTestAgentCatalog({
    defaultAgentId: 'global-agent',
    agents: [
      { id: 'main', enabled: true },
      { id: 'global-agent', enabled: true },
      { id: 'project-agent', enabled: true },
      { id: 'task-agent', enabled: true },
    ],
  });
  return ConfigSchema.parse({});
}

function projects(defaultAgentId?: string): ProjectService {
  return {
    get: () => ({ id: 'project-1', defaultAgentId }),
  } as unknown as ProjectService;
}

describe('resolveProjectAgentId', () => {
  it('prefers the task agent over project and global defaults', () => {
    expect(resolveProjectAgentId({
      config: config(),
      projects: projects('project-agent'),
      explicitAgentId: 'task-agent',
      projectId: 'project-1',
    })).toBe('task-agent');
  });

  it('uses the project default when the task has no agent', () => {
    expect(resolveProjectAgentId({
      config: config(),
      projects: projects('project-agent'),
      projectId: 'project-1',
    })).toBe('project-agent');
  });

  it('falls back to the global default when the project has no default', () => {
    expect(resolveProjectAgentId({
      config: config(),
      projects: projects(),
      projectId: 'project-1',
    })).toBe('global-agent');
  });

  it('rejects an explicitly selected missing agent', () => {
    expect(() => resolveProjectAgentId({
      config: config(),
      projects: projects('project-agent'),
      explicitAgentId: 'missing-agent',
      projectId: 'project-1',
    })).toThrow('Agent not found: missing-agent');
  });
});
