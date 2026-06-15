import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  markProfileMarkdownSeeded,
  resolveWorkspaceStatePathForMarkdownWorkspace,
} from '../workspace-state.js';

describe('workspace-state', () => {
  it('stores profile seed metadata in <markdownWorkspace>/.xopc/workspace.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-ws-state-'));
    const markdownWs = join(root, 'workspace');
    const statePath = resolveWorkspaceStatePathForMarkdownWorkspace(markdownWs);
    mkdirSync(join(markdownWs, '.xopc'), { recursive: true });

    markProfileMarkdownSeeded(statePath);

    const raw = JSON.parse(readFileSync(statePath, 'utf-8')) as {
      profileMarkdownSeededAt?: string;
    };
    expect(raw.profileMarkdownSeededAt).toBeTruthy();
    expect(existsSync(statePath)).toBe(true);
  });

  it('preserves init fields when marking profile seed', () => {
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

    markProfileMarkdownSeeded(statePath);

    const raw = JSON.parse(readFileSync(statePath, 'utf-8')) as {
      agentId?: string;
      profileMarkdownSeededAt?: string;
    };
    expect(raw.agentId).toBe('main');
    expect(raw.profileMarkdownSeededAt).toBe('2026-01-01T00:00:00.000Z');
    expect(existsSync(statePath)).toBe(true);
  });
});
