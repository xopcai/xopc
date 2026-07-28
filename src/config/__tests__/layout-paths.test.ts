/**
 * OpenClaw-aligned layout path resolution tests.
 *
 * Guards the 8 alignment points from `docs/layout-alignment-plan.md`:
 *  1. State root fixed at `~/.xopc` (no profile suffix)
 *  2. Default workspace at `~/.xopc/workspace` (no `/main`)
 *  3. Non-default agent workspace at `~/.xopc/workspace-<id>`
 *  4. Profile workspace at `~/.xopc/workspace-<profile>`
 *  5. Profile Markdown files live under `agents/<id>/profile/`
 *  6. Workspace state at `<workspace>/.xopc/workspace-state.json`
 *  7. Auth profiles at `agents/<id>/agent/auth-profiles.json` (no credentials subdir)
 *  8. Git init on brand-new workspace (tested in workspace-seed.test.ts)
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { resolveStateDir } from '../paths-state.js';
import { resolveDefaultAgentWorkspaceDir } from '../workspace-defaults.js';
import {
  resolveAgentWorkspaceDir,
  resolveAgentDir,
  resolveAgentHomeDir,
  resolveAgentProfileDir,
  resolveAgentProfileMarkdownPath,
  resolveDefaultAgentId,
} from '../../agent/agent-scope.js';
import {
  resolveWorkspaceStateDir,
  resolveWorkspaceStatePath,
  resolveAgentAuthProfilesPath,
  resolveAgentProfileDir as resolveAgentProfileDirFromPaths,
  resolveAgentProfileMarkdownPath as resolveAgentProfileMarkdownPathFromPaths,
  resolveXopcDatabasePath,
  resolveBundledExtensionsDir,
  hasBundledExtensionManifest,
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

describe('Layout alignment: state root and workspace paths', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.XOPC_STATE_DIR;
    delete process.env.XOPC_PROFILE;
    delete process.env.XOPC_WORKSPACE;
    delete process.env.XOPC_HOME;
    delete process.env.XOPC_BUNDLED_EXTENSIONS_ROOT;
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

  it('XOPC_BUNDLED_EXTENSIONS_ROOT overrides bundled extension discovery when it exists', () => {
    const dir = join(tmpdir(), `xopc-bundled-extensions-${process.pid}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    process.env.XOPC_BUNDLED_EXTENSIONS_ROOT = dir;
    try {
      expect(existsSync(dir)).toBe(true);
      expect(resolveBundledExtensionsDir()).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recognizes bundled extension directories only when they contain a manifest file', () => {
    const dir = join(tmpdir(), `xopc-incomplete-bundled-extensions-${process.pid}`);
    const extensionDir = join(dir, 'telegram');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(extensionDir, { recursive: true });
    try {
      expect(hasBundledExtensionManifest(dir)).toBe(false);

      mkdirSync(join(extensionDir, 'xopc.extension.json'));
      expect(hasBundledExtensionManifest(dir)).toBe(false);

      rmSync(join(extensionDir, 'xopc.extension.json'), { recursive: true, force: true });
      writeFileSync(join(extensionDir, 'xopc.extension.json'), '{}');
      expect(hasBundledExtensionManifest(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Layout alignment: agent internal paths', () => {
  it('#5: resolveAgentProfileDir is agents/<id>/profile/', () => {
    const cfg = makeMultiAgentConfig();
    expect(resolveAgentProfileDir(cfg, 'main')).toBe(join(STATE_DIR, 'agents', 'main', 'profile'));
    expect(resolveAgentProfileDir(cfg, 'helper')).toBe(join(STATE_DIR, 'agents', 'helper', 'profile'));
  });

  it('#5: resolveAgentProfileMarkdownPath matches paths.ts wrappers', () => {
    const cfg = makeMultiAgentConfig();
    expect(resolveAgentProfileMarkdownPath(cfg, 'main', 'SOUL.md')).toBe(
      join(STATE_DIR, 'agents', 'main', 'profile', 'SOUL.md'),
    );
    expect(resolveAgentProfileMarkdownPathFromPaths(cfg, 'helper', 'IDENTITY.md')).toBe(
      resolveAgentProfileMarkdownPath(cfg, 'helper', 'IDENTITY.md'),
    );
    expect(resolveAgentProfileDirFromPaths(cfg, 'research')).toBe(resolveAgentProfileDir(cfg, 'research'));
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

  it('resolveXopcDatabasePath returns ~/.xopc/xopc.db', () => {
    expect(resolveXopcDatabasePath()).toBe(join(STATE_DIR, FILENAMES.XOPC_DB));
  });
});

describe('Layout alignment: workspace state and auth profiles', () => {
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
