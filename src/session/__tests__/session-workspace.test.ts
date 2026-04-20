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
      defaults: {
        workspace: '~/default-ws',
        model: 'x/y',
        maxTokens: 100,
        temperature: 0,
        maxToolIterations: 1,
        maxRequestsPerTurn: 1,
        maxToolFailuresPerTurn: 1,
      },
    },
  } as unknown as Config;

  it('uses profile default when no override', () => {
    const p = effectiveWorkspacePathForSession(minimalCfg, 'gateway:main:webchat:default:direct:x', null);
    expect(p).toContain('default-ws');
  });

  it('uses override when set in session config', () => {
    const tmp = resolve('/tmp/session-override-test');
    const p = effectiveWorkspacePathForSession(minimalCfg, 'gateway:main:webchat:default:direct:x', {
      workingDirectoryOverride: tmp,
    });
    expect(p).toBe(tmp);
  });
});
