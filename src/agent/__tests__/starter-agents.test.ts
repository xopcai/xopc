import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/index.js';
import { resolveAgentProfileDir } from '../agent-scope.js';
import { ensureStarterAgentsInitialized } from '../starter-agents.js';

describe('starter conductor Agent', () => {
  let stateDir: string;
  let previousStateDir: string | undefined;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-starter-conductor-'));
    previousStateDir = process.env.XOPC_STATE_DIR;
    process.env.XOPC_STATE_DIR = stateDir;
    closeXopcDatabase();
    openXopcDatabase({ path: ':memory:' });
    new AgentCatalogRepository().ensureInitialized();
  });

  afterEach(() => {
    closeXopcDatabase();
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('adds conductor without changing the default main Agent', () => {
    expect(ensureStarterAgentsInitialized().changed).toBe(true);
    const catalog = new AgentCatalogRepository();
    expect(catalog.getSettings().defaultAgentId).toBe('main');
    expect(catalog.get('conductor')).toMatchObject({
      enabled: true, provisioningState: 'ready', profile: { name: 'Conductor' },
      skills: { mode: 'replace', include: [] },
      toolAllowlist: [
        'xopc_use', 'tool_manual', 'session_recall',
        'knowledge_search', 'knowledge_get', 'user_context_search', 'user_context_get',
        'find', 'grep', 'read_file',
      ],
    });
    expect(catalog.get('conductor')?.profile?.instructions).toContain('user-facing coordination Agent');
    expect(catalog.get('conductor')?.profile?.instructions).not.toContain('report only to main');
    expect(readFileSync(join(resolveAgentProfileDir('conductor'), 'SOUL.md'), 'utf8'))
      .toContain('You speak directly with the user');
    expect(ensureStarterAgentsInitialized().changed).toBe(false);
  });

  it('preserves an existing custom conductor profile and instructions', () => {
    const catalog = new AgentCatalogRepository();
    catalog.create({ id: 'conductor', profile: { name: '我的指挥家', instructions: '我的规则' } }, { ready: true });
    ensureStarterAgentsInitialized();
    const soulPath = join(resolveAgentProfileDir('conductor'), 'SOUL.md');
    writeFileSync(soulPath, '自定义档案');
    ensureStarterAgentsInitialized();
    expect(catalog.get('conductor')?.profile).toEqual({ name: '我的指挥家', instructions: '我的规则' });
    expect(catalog.get('conductor')).toMatchObject({
      skills: { mode: 'replace', include: [] },
      toolAllowlist: [
        'xopc_use', 'tool_manual', 'session_recall',
        'knowledge_search', 'knowledge_get', 'user_context_search', 'user_context_get',
        'find', 'grep', 'read_file',
      ],
    });
    expect(readFileSync(soulPath, 'utf8')).toBe('自定义档案');
  });
});
