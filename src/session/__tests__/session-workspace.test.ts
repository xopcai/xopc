import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  normalizeWorkingDirectoryInput,
  effectiveWorkspacePathForSession,
} from '../session-workspace.js';
import type { Config } from '../../config/schema.js';

describe('normalizeWorkingDirectoryInput', () => {
  it('rejects empty string', () => {
    expect(normalizeWorkingDirectoryInput('').ok).toBe(false);
    expect(normalizeWorkingDirectoryInput('   ').ok).toBe(false);
  });

  it('resolves tilde and normalizes', () => {
    const r = normalizeWorkingDirectoryInput('~/foo-bar-wd');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.path).toBe(resolve(join(homedir(), 'foo-bar-wd')));
    }
  });

  it('rejects filesystem root', () => {
    const r = normalizeWorkingDirectoryInput('/');
    expect(r.ok).toBe(false);
  });
});

describe('effectiveWorkspacePathForSession', () => {
  const minimalCfg = {
    agents: {
      default: 'main',
      defaultPreset: 'default',
      capabilityPresets: {
        default: {
          id: 'default',
          name: 'Global defaults',
          models: { defaultRole: 'deep', roles: { deep: { model: 'anthropic/claude-sonnet-4-5' } } },
        },
      },
      list: [
        {
          id: 'main',
          identity: { name: 'Main', role: 'General assistant' },
          responsibilities: { primary: ['Help the user complete tasks'] },
          workspace: { root: '~/default-ws' },
          tools: { builtin: {} },
          skills: { mode: 'all' },
          memory: { mode: 'confirmWrite', sources: ['session'] },
          workflows: {},
          boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
        },
      ],
    },
  } as unknown as Config;

  it('uses profile default when no override', () => {
    const p = effectiveWorkspacePathForSession(minimalCfg, 'agent:main:webchat:default:direct:x', null);
    expect(p).toContain('default-ws');
  });

  it('uses override when set in session config', () => {
    const tmp = resolve('/tmp/session-override-test');
    const p = effectiveWorkspacePathForSession(minimalCfg, 'agent:main:webchat:default:direct:x', {
      workingDirectoryOverride: tmp,
    });
    expect(p).toBe(tmp);
  });

  it('uses project workspace before session override', () => {
    const override = resolve('/tmp/session-override-test');
    const projectRoot = resolve('/tmp/project-workspace-test');
    const p = effectiveWorkspacePathForSession(
      minimalCfg,
      'agent:main:webchat:default:direct:x',
      { workingDirectoryOverride: override },
      { workspaceRoot: projectRoot },
    );
    expect(p).toBe(projectRoot);
  });
});
