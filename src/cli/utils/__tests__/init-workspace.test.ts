import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { initWorkspace } from '../init-workspace.js';

describe('initWorkspace', () => {
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

  it('persists agents.defaults.workspace as dirname(workspacePath) when persistWorkspacePath', async () => {
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
      expect(result.config.agents?.defaults?.workspace).toBe(join(root, 'workspace'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
