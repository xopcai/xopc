import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/index.js';
import { cutoverLegacyAgentConfig } from '../migrations/legacy-config-cutover.js';
import { AgentCatalogRepository } from '../repository.js';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'xopc-agent-cutover-'));
  const configPath = join(directory, 'xopc.json');
  const databasePath = join(directory, 'xopc.db');
  writeFileSync(configPath, JSON.stringify({
    agents: {
      default: 'coder',
      defaults: { models: { chat: { primary: 'test/model', fallbacks: [] }, intents: {} } },
      list: [
        { id: 'main', enabled: true, profile: { name: 'Main' } },
        { id: 'coder', enabled: true, workspace: '/tmp/coder', profile: { name: 'Coder' },
          tools: { exec_command: { mode: 'ask' } } },
      ],
    },
    bindings: [{ id: 'telegram-coder', agentId: 'coder', match: { channel: 'telegram' } }],
    tui: { defaultAgent: 'coder' },
    gateway: { port: 18790 },
  }, null, 2));
  closeXopcDatabase();
  openXopcDatabase({ path: databasePath });
  return { configPath };
}

afterEach(() => closeXopcDatabase());

describe('legacy Agent config cutover', () => {
  it('imports Agent state and removes legacy JSON fields', () => {
    const { configPath } = fixture();
    const result = cutoverLegacyAgentConfig({ configPath });

    expect(result).toMatchObject({ status: 'migrated', importedAgents: 2, importedBindings: 1 });
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(raw).toEqual({ gateway: { port: 18790 } });
    expect(new AgentCatalogRepository().snapshot()).toMatchObject({
      defaultAgentId: 'coder',
      agents: [expect.objectContaining({ id: 'coder' }), expect.objectContaining({ id: 'main' })],
      bindings: [expect.objectContaining({ id: 'telegram-coder', agentId: 'coder' })],
      surfaceDefaults: { tui: 'coder' },
    });
  });

  it('recovers after the database commit without duplicating data', () => {
    const { configPath } = fixture();
    expect(() => cutoverLegacyAgentConfig({ configPath, stopAfterStage: 'database' }))
      .toThrow('database stage');

    expect(cutoverLegacyAgentConfig({ configPath }).status).toBe('recovered');
    expect(new AgentCatalogRepository().list()).toHaveLength(2);
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).not.toHaveProperty('agents');
  });

  it('finishes an interrupted marker after the config was replaced', () => {
    const { configPath } = fixture();
    expect(() => cutoverLegacyAgentConfig({ configPath, stopAfterStage: 'config' }))
      .toThrow('config stage');

    expect(cutoverLegacyAgentConfig({ configPath }).status).toBe('recovered');
    expect(new AgentCatalogRepository().list()).toHaveLength(2);
  });

  it('initializes a new catalog when no legacy fields exist', () => {
    const directory = mkdtempSync(join(tmpdir(), 'xopc-agent-new-'));
    const configPath = join(directory, 'xopc.json');
    writeFileSync(configPath, '{}');
    closeXopcDatabase();
    openXopcDatabase({ path: ':memory:' });

    expect(cutoverLegacyAgentConfig({ configPath }).status).toBe('not_needed');
    expect(new AgentCatalogRepository().getSettings().defaultAgentId).toBe('main');
  });
});
