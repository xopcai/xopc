/**
 * OpenClaw-aligned layout path resolution tests.
 *
 * Guards the 8 alignment points from `docs/layout-alignment-plan.md`:
 *  1. State root fixed at `~/.xopc` (no profile suffix)
 *  2. Default workspace at `~/.xopc/workspace` (no `/main`)
 *  3. Non-default agent workspace at `~/.xopc/workspace-<id>`
 *  4. Profile workspace at `~/.xopc/workspace-<profile>`
 *  5. Bootstrap files live in workspace root (no separate bootstrap dir)
 *  6. Workspace state at `<workspace>/.xopc/workspace-state.json`
 *  7. Auth profiles at `agents/<id>/agent/auth-profiles.json` (no credentials subdir)
 *  8. Git init on brand-new workspace (tested in workspace-seed.test.ts)
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { resolveStateDir } from '../paths-state.js';
import { resolveDefaultAgentWorkspaceDir } from '../workspace-defaults.js';
import {
  resolveAgentWorkspaceDir,
  resolveAgentDir,
  resolveAgentHomeDir,
  resolveSessionsDir,
  resolveDefaultAgentId,
} from '../../agent/agent-scope.js';
import {
  resolveWorkspaceStateDir,
  resolveWorkspaceStatePath,
  resolveAgentAuthProfilesPath,
  resolveSessionsMapPath,
  FILENAMES,
} from '../paths.js';

const HOME = homedir();
const STATE_DIR = join(HOME, '.xopc');

function makeConfig(overrides: Record<string, unknown> = {}): any {
  return { agents: { list: [], defaults: {} }, ...overrides };
}

function makeMultiAgentConfig(): any {
  return {
    agents: {
      default: 'main',
      list: [
        { id: 'main', default: true },
        { id: 'helper' },
        { id: 'research' },
      ],
      defaults: {},
    },
  };
}

describe('Layout alignment: Phase 1 — State Root & Workspace Paths', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.XOPC_STATE_DIR;
    delete process.env.XOPC_PROFILE;
    delete process.env.XOPC_WORKSPACE;
    delete process.env.XOPC_HOME;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('#1: resolveStateDir is fixed ~/.xopc regardless of profile', () => {
    expect(resolveStateDir()).toBe(STATE_DIR);

    process.env.XOPC_PROFILE = 'dev';
    expect(resolveStateDir()).toBe(STATE_DIR);

    process.env.XOPC_PROFILE = 'production';
    expect(resolveStateDir()).toBe(STATE_DIR);
  });

  it('#2: default workspace is ~/.xopc/workspace (no /main suffix)', () => {
    const result = resolveDefaultAgentWorkspaceDir(process.env);
    expect(result).toBe(join(STATE_DIR, 'workspace'));
    expect(result).not.toContain('/main');
  });

  it('#3: non-default agent workspace is ~/.xopc/workspace-<id>', () => {
    const cfg = makeMultiAgentConfig();
    expect(resolveAgentWorkspaceDir(cfg, 'helper')).toBe(join(STATE_DIR, 'workspace-helper'));
    expect(resolveAgentWorkspaceDir(cfg, 'research')).toBe(join(STATE_DIR, 'workspace-research'));
  });

  it('#4: profile workspace is ~/.xopc/workspace-<profile>', () => {
    process.env.XOPC_PROFILE = 'staging';
    const result = resolveDefaultAgentWorkspaceDir(process.env);
    expect(result).toBe(join(STATE_DIR, 'workspace-staging'));
  });

  it('#4: profile "default" returns plain workspace', () => {
    process.env.XOPC_PROFILE = 'default';
    const result = resolveDefaultAgentWorkspaceDir(process.env);
    expect(result).toBe(join(STATE_DIR, 'workspace'));
  });

  it('default agent (main) workspace matches resolveDefaultAgentWorkspaceDir', () => {
    const cfg = makeMultiAgentConfig();
    const fromScope = resolveAgentWorkspaceDir(cfg, 'main');
    const fromDefault = resolveDefaultAgentWorkspaceDir(process.env);
    expect(fromScope).toBe(fromDefault);
  });

  it('XOPC_WORKSPACE env overrides default workspace', () => {
    process.env.XOPC_WORKSPACE = '/custom/workspace';
    const result = resolveDefaultAgentWorkspaceDir(process.env);
    expect(result).toBe('/custom/workspace');
  });
});

describe('Layout alignment: Phase 2 — Agent Internal Paths', () => {
  it('#5: no resolveAgentBootstrapDir exists (bootstrap in workspace root)', async () => {
    // Verify resolveAgentBootstrapDir is not exported from paths or agent-scope.
    const pathsMod = await import('../paths.js');
    const scopeMod = await import('../../agent/agent-scope.js');
    expect('resolveAgentBootstrapDir' in pathsMod).toBe(false);
    expect('resolveAgentBootstrapDir' in scopeMod).toBe(false);
  });

  it('resolveAgentDir returns agents/<id>/agent/', () => {
    const cfg = makeMultiAgentConfig();
    expect(resolveAgentDir(cfg, 'main')).toBe(join(STATE_DIR, 'agents', 'main', 'agent'));
    expect(resolveAgentDir(cfg, 'helper')).toBe(join(STATE_DIR, 'agents', 'helper', 'agent'));
  });

  it('resolveAgentHomeDir returns agents/<id>/', () => {
    const cfg = makeMultiAgentConfig();
    expect(resolveAgentHomeDir(cfg, 'main')).toBe(join(STATE_DIR, 'agents', 'main'));
    expect(resolveAgentHomeDir(cfg, 'helper')).toBe(join(STATE_DIR, 'agents', 'helper'));
  });

  it('resolveSessionsDir returns agents/<id>/sessions/', () => {
    const cfg = makeMultiAgentConfig();
    expect(resolveSessionsDir(cfg, 'main')).toBe(join(STATE_DIR, 'agents', 'main', 'sessions'));
    expect(resolveSessionsDir(cfg, 'helper')).toBe(join(STATE_DIR, 'agents', 'helper', 'sessions'));
  });

  it('resolveSessionsMapPath returns agents/<id>/sessions/sessions.json', () => {
    const cfg = makeMultiAgentConfig();
    expect(resolveSessionsMapPath(cfg, 'main')).toBe(
      join(STATE_DIR, 'agents', 'main', 'sessions', 'sessions.json'),
    );
  });
});

describe('Layout alignment: Phase 3 — Workspace State & Auth Profiles', () => {
  it('#6: workspace state dir is <workspace>/.xopc/', () => {
    const cfg = makeMultiAgentConfig();
    const wsDir = resolveAgentWorkspaceDir(cfg, 'main');
    expect(resolveWorkspaceStateDir(cfg, 'main')).toBe(join(wsDir, '.xopc'));
  });

  it('#6: workspace state path is <workspace>/.xopc/workspace.json', () => {
    const cfg = makeMultiAgentConfig();
    const wsDir = resolveAgentWorkspaceDir(cfg, 'main');
    expect(resolveWorkspaceStatePath(cfg, 'main')).toBe(join(wsDir, '.xopc', FILENAMES.WORKSPACE_STATE));
  });

  it('#7: auth profiles at agents/<id>/agent/auth-profiles.json (no credentials/ subdir)', () => {
    const cfg = makeMultiAgentConfig();
    const expected = join(STATE_DIR, 'agents', 'main', 'agent', 'auth-profiles.json');
    expect(resolveAgentAuthProfilesPath(cfg, 'main')).toBe(expected);
    // Verify no "credentials" in path
    expect(resolveAgentAuthProfilesPath(cfg, 'main')).not.toContain('credentials');
  });

  it('#7: non-default agent auth profiles path', () => {
    const cfg = makeMultiAgentConfig();
    const expected = join(STATE_DIR, 'agents', 'helper', 'agent', 'auth-profiles.json');
    expect(resolveAgentAuthProfilesPath(cfg, 'helper')).toBe(expected);
  });
});

describe('Layout alignment: Agent ID resolution', () => {
  it('resolveDefaultAgentId returns "main" with empty config', () => {
    const cfg = makeConfig();
    expect(resolveDefaultAgentId(cfg)).toBe('main');
  });

  it('resolveDefaultAgentId respects agents.default', () => {
    const cfg = makeConfig({ agents: { default: 'helper', list: [{ id: 'helper' }] } });
    expect(resolveDefaultAgentId(cfg)).toBe('helper');
  });

  it('resolveDefaultAgentId picks first default:true entry', () => {
    const cfg = makeConfig({
      agents: {
        list: [
          { id: 'alpha' },
          { id: 'beta', default: true },
        ],
      },
    });
    expect(resolveDefaultAgentId(cfg)).toBe('beta');
  });

  it('resolveDefaultAgentId picks first entry when no default flag', () => {
    const cfg = makeConfig({
      agents: { list: [{ id: 'alpha' }, { id: 'beta' }] },
    });
    expect(resolveDefaultAgentId(cfg)).toBe('alpha');
  });
});
