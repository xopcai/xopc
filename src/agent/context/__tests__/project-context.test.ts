import { describe, expect, it } from 'vitest';

import type { GoalWithDetails } from '../../../goals/index.js';
import type { Project } from '../../../projects/types.js';
import { formatActiveProjectContextForPrompt } from '../project-context.js';

const project: Project = {
  id: 'project-1',
  name: 'xopc',
  slug: 'xopc',
  description: 'Personal assistant runtime',
  status: 'active',
  workspaceRoot: '/tmp/xopc',
  brief: 'Ship the Project feature.',
  instructions: 'Keep work scoped to Project context.',
  createdAt: 1,
  updatedAt: 2,
};

function goal(patch: Partial<GoalWithDetails> = {}): GoalWithDetails {
  return {
    id: 'goal-1',
    title: 'Finish project context',
    status: 'active',
    agentId: 'main',
    priority: 'high',
    createdAt: 1,
    updatedAt: 2,
    maxTurns: 10,
    turnsUsed: 0,
    source: 'api',
    checklist: [],
    ...patch,
  };
}

describe('formatActiveProjectContextForPrompt', () => {
  it('formats project metadata, goals, and recent sessions', () => {
    const text = formatActiveProjectContextForPrompt({
      project,
      workspacePath: '/tmp/xopc',
      activeGoals: [goal({ nextAction: 'Add prompt injection.' })],
      recentSessions: [
        {
          key: 'agent:main:webchat:default:direct:s1',
          name: 'Project planning',
          updatedAt: '2026-07-06T00:00:00.000Z',
          agentId: 'main',
        },
      ],
      memoryRecords: [
        {
          kind: 'session_summary',
          content: 'Decided to keep Project separate from Agent and Model.',
          updatedAt: '2026-07-06T01:00:00.000Z',
        },
      ],
    });

    expect(text).toContain('# Active Project');
    expect(text).toContain('Project: xopc');
    expect(text).toContain('Workspace root: /tmp/xopc');
    expect(text).toContain('Ship the Project feature.');
    expect(text).toContain('Keep work scoped to Project context.');
    expect(text).toContain('- Finish project context | status=active | priority=high | next=Add prompt injection.');
    expect(text).toContain('- Project planning | agent=main | updated=2026-07-06T00:00:00.000Z');
    expect(text).toContain('- session_summary | updated=2026-07-06T01:00:00.000Z | Decided to keep Project separate from Agent and Model.');
  });

  it('uses explicit empty markers when there are no goals or sessions', () => {
    const text = formatActiveProjectContextForPrompt({
      project: { ...project, brief: undefined, instructions: undefined },
      activeGoals: [],
      recentSessions: [],
    });

    expect(text).toContain('## Active Goals\n- None recorded.');
    expect(text).toContain('## Recent Project Sessions\n- None recorded.');
    expect(text).toContain('## Project Memory\n- None recorded.');
  });

  it('tells coder sessions which local-app release is stable', () => {
    const text = formatActiveProjectContextForPrompt({
      project,
      activeGoals: [],
      recentSessions: [],
      localApp: {
        extensionId: 'local-reading-list-abcd1234',
        draftVersion: 3,
        activeVersion: 2,
        installationState: 'installed',
        enabled: true,
        retainedVersions: [2, 1],
        latestAcceptance: {
          status: 'failed',
          sourceHash: '1234567890abcdef',
          failures: ['One interactive control needs an accessible name'],
          createdAt: 1234,
        },
      },
    });

    expect(text).toContain('## Local App Runtime');
    expect(text).toContain('Draft version: v3');
    expect(text).toContain('Installed version: v2');
    expect(text).toContain('Retained releases: v2, v1');
    expect(text).toContain('Latest acceptance: failed | source=1234567890ab | checked=1970-01-01T00:00:01.234Z');
    expect(text).toContain('Acceptance failure: One interactive control needs an accessible name');
    expect(text).toContain('Do not modify installed release artifacts directly');
  });
});
