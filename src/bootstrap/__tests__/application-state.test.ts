import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { loadConfig } from '../../config/loader.js';
import { closeXopcDatabase } from '../../storage/sqlite/index.js';
import { bootstrapApplicationStateSync } from '../application-state.js';

const originalStateDir = process.env.XOPC_STATE_DIR;
const directories: string[] = [];

function useTempState(): { stateDir: string; configPath: string } {
  const stateDir = mkdtempSync(join(tmpdir(), 'xopc-bootstrap-'));
  directories.push(stateDir);
  process.env.XOPC_STATE_DIR = stateDir;
  closeXopcDatabase();
  return { stateDir, configPath: join(stateDir, 'xopc.json') };
}

afterEach(() => {
  closeXopcDatabase();
  if (originalStateDir === undefined) delete process.env.XOPC_STATE_DIR;
  else process.env.XOPC_STATE_DIR = originalStateDir;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('bootstrapApplicationStateSync', () => {
  it('cuts over legacy Agent fields before strict config loading', () => {
    const { stateDir, configPath } = useTempState();
    writeFileSync(configPath, `${JSON.stringify({
      agents: {
        default: 'main',
        defaults: { models: { chat: { primary: 'test/model', fallbacks: [] }, intents: {} } },
        list: [{ id: 'main', enabled: true, profile: { name: 'Existing Main' } }],
      },
      bindings: [{ id: 'main-web', agentId: 'main', match: { channel: 'web' } }],
      tui: { defaultAgent: 'main' },
    }, null, 2)}\n`);

    const result = bootstrapApplicationStateSync(configPath);

    expect(result.agentCatalog.status).toBe('migrated');
    expect(() => loadConfig(configPath)).not.toThrow();
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({});
    expect(new AgentCatalogRepository().snapshot()).toMatchObject({
      defaultAgentId: 'main',
      bindings: [{ id: 'main-web', agentId: 'main' }],
      surfaceDefaults: { tui: 'main' },
    });
    expect(existsSync(join(stateDir, 'xopc.json.pre-agent-sqlite-v1.bak'))).toBe(true);
  });

  it('initializes and provisions the catalog for a new installation', () => {
    const { stateDir, configPath } = useTempState();

    const result = bootstrapApplicationStateSync(configPath);

    expect(result.agentCatalog.status).toBe('not_needed');
    const repository = new AgentCatalogRepository();
    expect(repository.listPendingProvisioningAgentIds()).toEqual([]);
    expect(repository.snapshot().agents.map((agent) => agent.id)).toEqual([
      'coder', 'creative', 'data-analyst', 'main', 'researcher', 'writer',
    ]);
    expect(existsSync(join(stateDir, 'agents', 'main', 'profile', 'IDENTITY.md'))).toBe(true);
  });
});
