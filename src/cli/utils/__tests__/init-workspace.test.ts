import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { initWorkspace } from '../init-workspace.js';
import { initWorkspaceCore } from '../init-workspace-core.js';

describe('initWorkspace', () => {
  beforeAll(async () => {
    await import('../../../config/validate-channel-configs.js');
  }, 30_000);

  it('creates config and workspace with skipChannelPluginValidation (Electron path; no bundled channel graph)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-init-skip-'));
    try {
      const configPath = join(root, 'xopc.json');
      const workspacePath = join(root, 'workspace', 'main');
      const result = await initWorkspace({
        configPath,
        workspacePath,
        skipChannelPluginValidation: true,
      });
      expect(result.token.length).toBeGreaterThan(10);
      expect(result.configCreated).toBe(true);
      const raw = readFileSync(configPath, 'utf8');
      expect(raw).toContain('"token"');
      expect(raw).toContain(result.token);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('initWorkspaceCore matches Electron shell init without channel plugins', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-init-core-'));
    try {
      const configPath = join(root, 'xopc.json');
      const workspacePath = join(root, 'workspace', 'main');
      const result = await initWorkspaceCore({
        configPath,
        workspacePath,
        persistWorkspacePath: true,
      });
      expect(result.token.length).toBeGreaterThan(10);
      expect(result.configCreated).toBe(true);
      expect(readFileSync(configPath, 'utf8')).toContain(result.token);
      expect(result.config.tui.defaultAgent).toBe('coder');
      expect(result.config.agents.list.some((agent) => agent.id === 'coder')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('creates config with full channel plugin validation by default', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-init-full-'));
    try {
      const configPath = join(root, 'xopc.json');
      const workspacePath = join(root, 'workspace', 'main');
      const result = await initWorkspace({
        configPath,
        workspacePath,
      });
      expect(result.token.length).toBeGreaterThan(10);
      expect(readFileSync(configPath, 'utf8')).toContain(result.token);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('persists default agent workspace root when persistWorkspacePath', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-init-persist-'));
    try {
      const configPath = join(root, 'xopc.json');
      const workspacePath = join(root, 'workspace', 'main');
      const result = await initWorkspace({
        configPath,
        workspacePath,
        persistWorkspacePath: true,
        skipChannelPluginValidation: true,
      });
      const main = result.config.agents?.list.find((agent) => agent.id === 'main');
      expect(main?.workspace.root).toBe(workspacePath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
