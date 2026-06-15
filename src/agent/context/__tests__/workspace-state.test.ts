import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { WORKSPACE_FILES } from '../../../config/paths.js';
import {
  isWorkspaceSetupCompleted,
  markBootstrapSeeded,
  markSetupCompleted,
  resolveWorkspaceStatePathForMarkdownWorkspace,
  syncBootstrapSetupCompletion,
} from '../workspace-state.js';

describe('workspace-state', () => {
  it('stores bootstrap lifecycle fields in <markdownWorkspace>/.xopc/workspace.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-ws-state-'));
    const profileDir = join(root, 'profile');
    const markdownWs = join(root, 'workspace');
    const statePath = resolveWorkspaceStatePathForMarkdownWorkspace(markdownWs);
    mkdirSync(profileDir, { recursive: true });

    markBootstrapSeeded(statePath);
    expect(isWorkspaceSetupCompleted(statePath)).toBe(false);

    writeFileSync(join(profileDir, WORKSPACE_FILES.BOOTSTRAP), '# bootstrap', 'utf-8');
    syncBootstrapSetupCompletion(statePath, profileDir);
    expect(isWorkspaceSetupCompleted(statePath)).toBe(false);

    rmSync(join(profileDir, WORKSPACE_FILES.BOOTSTRAP));
    syncBootstrapSetupCompletion(statePath, profileDir);
    expect(isWorkspaceSetupCompleted(statePath)).toBe(true);

    const raw = JSON.parse(readFileSync(statePath, 'utf-8')) as {
      bootstrapSeededAt?: string;
      setupCompletedAt?: string;
      profileMarkdownSeededAt?: string;
    };
    expect(raw.bootstrapSeededAt).toBeTruthy();
    expect(raw.setupCompletedAt).toBeTruthy();
  });

  it('preserves init fields when marking bootstrap state', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-ws-state-init-'));
    const markdownWs = join(root, 'workspace');
    const statePath = resolveWorkspaceStatePathForMarkdownWorkspace(markdownWs);
    mkdirSync(join(markdownWs, '.xopc'), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify(
        {
          version: 1,
          agentId: 'main',
          profileMarkdownSeededAt: '2026-01-01T00:00:00.000Z',
        },
        null,
        2,
      ),
      'utf-8',
    );

    markBootstrapSeeded(statePath);
    markSetupCompleted(statePath);

    const raw = JSON.parse(readFileSync(statePath, 'utf-8')) as {
      agentId?: string;
      profileMarkdownSeededAt?: string;
      bootstrapSeededAt?: string;
      setupCompletedAt?: string;
    };
    expect(raw.agentId).toBe('main');
    expect(raw.profileMarkdownSeededAt).toBe('2026-01-01T00:00:00.000Z');
    expect(raw.bootstrapSeededAt).toBeTruthy();
    expect(raw.setupCompletedAt).toBeTruthy();
    expect(existsSync(statePath)).toBe(true);
  });
});
