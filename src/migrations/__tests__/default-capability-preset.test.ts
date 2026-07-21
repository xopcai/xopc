import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { applyMigrations, detectMigrations } from '../runner.js';

function withTempConfig(initial: unknown, fn: (paths: { dir: string; configPath: string }) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-migration-test-'));
  try {
    const configPath = join(dir, 'xopc.json');
    writeFileSync(configPath, JSON.stringify(initial, null, 2), 'utf8');
    fn({ dir, configPath });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('default capability preset migration', () => {
  it('initializes default preset for old configs with empty capabilityPresets', () => {
    withTempConfig({
      agents: {
        default: 'main',
        capabilityPresets: {},
        list: [
          {
            id: 'main',
            enabled: true,
            identity: { name: 'Main', role: 'General assistant', language: 'en', tone: 'direct' },
            responsibilities: { primary: ['Help the user complete tasks'] },
            workspace: { root: '~/.xopc/workspace/main' },
            tools: { builtin: {} },
            skills: { mode: 'all' },
            workflows: {},
            boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
          },
        ],
      },
    }, ({ dir, configPath }) => {
      expect(detectMigrations(configPath, { stateDir: dir })).toHaveLength(1);
      const result = applyMigrations(configPath, { stateDir: dir, mode: 'auto-safe' });
      expect(result.changed).toBe(true);
      expect(result.items[0]?.status).toBe('applied');
      const json = readJson(configPath);
      expect(json.agents.defaultPreset).toBe('default');
      expect(json.agents.capabilityPresets.default.name).toBe('Global defaults');
    });
  });

  it('does not overwrite an existing valid default preset', () => {
    withTempConfig({
      agents: {
        default: 'main',
        defaultPreset: 'default',
        capabilityPresets: {
          default: { id: 'default', name: 'Custom defaults', version: 3 },
        },
        list: [],
      },
    }, ({ dir, configPath }) => {
      expect(detectMigrations(configPath, { stateDir: dir })).toHaveLength(0);
      const result = applyMigrations(configPath, { stateDir: dir, mode: 'auto-safe' });
      expect(result.changed).toBe(false);
      expect(readJson(configPath).agents.capabilityPresets.default.name).toBe('Custom defaults');
    });
  });

  it('reports invalid existing default preset as a conflict', () => {
    withTempConfig({
      agents: {
        default: 'main',
        defaultPreset: 'default',
        capabilityPresets: {
          default: { id: 'default', version: 1 },
        },
        list: [],
      },
    }, ({ dir, configPath }) => {
      const items = detectMigrations(configPath, { stateDir: dir });
      expect(items[0]?.status).toBe('conflict');
      const result = applyMigrations(configPath, { stateDir: dir, mode: 'auto-safe' });
      expect(result.changed).toBe(false);
      expect(result.items[0]?.status).toBe('conflict');
    });
  });
});
