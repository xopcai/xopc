import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import { resolveProjectAgentId } from '../project-agent.js';
import type { ProjectService } from '../project-service.js';

const config = {
  agents: {
    default: 'global-agent',
    list: [
      { id: 'global-agent', enabled: true },
      { id: 'project-agent', enabled: true },
      { id: 'task-agent', enabled: true },
    ],
  },
} as Config;

function projects(defaultAgentId?: string): ProjectService {
  return {
    get: () => ({ id: 'project-1', defaultAgentId }),
  } as unknown as ProjectService;
}

describe('resolveProjectAgentId', () => {
  it('prefers the task agent over project and global defaults', () => {
    expect(resolveProjectAgentId({
      config,
      projects: projects('project-agent'),
      explicitAgentId: 'task-agent',
      projectId: 'project-1',
    })).toBe('task-agent');
  });

  it('uses the project default when the task has no agent', () => {
    expect(resolveProjectAgentId({
      config,
      projects: projects('project-agent'),
      projectId: 'project-1',
    })).toBe('project-agent');
  });

  it('falls back to the global default when the project has no default', () => {
    expect(resolveProjectAgentId({
      config,
      projects: projects(),
      projectId: 'project-1',
    })).toBe('global-agent');
  });

  it('falls back from a stale task agent to the project default', () => {
    expect(resolveProjectAgentId({
      config,
      projects: projects('project-agent'),
      explicitAgentId: 'missing-agent',
      projectId: 'project-1',
    })).toBe('project-agent');
  });
});
