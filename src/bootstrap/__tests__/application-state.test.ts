import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { loadConfig } from '../../config/loader.js';
import { migrateCloudPublicModelsSync } from '../../migrations/cloud-public-models.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { ensureSessionRecord } from '../../storage/sqlite/session-repository.js';
import { setSessionConfig, getSessionConfig } from '../../storage/sqlite/config-repository.js';
import { createWorkflowCatalog } from '../../agent/workflow/catalog.js';
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
      'coder', 'conductor', 'creative', 'data-analyst', 'main', 'researcher', 'writer',
    ]);
    expect(existsSync(join(stateDir, 'agents', 'main', 'profile', 'IDENTITY.md'))).toBe(false);
  });
});

it('migrates cloud references offline exactly once with a recoverable backup', () => {
  const { configPath } = useTempState();
  writeFileSync(configPath, JSON.stringify({ agents: { defaults: { models: { chat: { primary: 'xopc-cloud/deepseek-v4-flash', fallbacks: ['openai/gpt-5'] }, imageGeneration: { primary: 'xopc-cloud/image-01' } } }, list: [{ id: 'main', enabled: true, models: { chat: { primary: 'xopc-cloud/glm-5', fallbacks: [] } } }] }, messages: { tts: { provider: 'xopc-cloud', providers: { 'xopc-cloud': { model: 'qwen3-tts-flash', voice: 'Cherry' } } } } }));
  bootstrapApplicationStateSync(configPath);
  const snapshot = new AgentCatalogRepository().snapshot();
  expect(snapshot.defaults.models.chat.primary).toBe('xopc-cloud/auto');
  expect(snapshot.defaults.models.imageGeneration?.primary).toBe('xopc-cloud/image');
  expect(snapshot.agents.find(agent => agent.id === 'main')?.models?.chat?.primary).toBe('xopc-cloud/auto');
  expect(() => loadConfig(configPath)).not.toThrow();
  expect(JSON.parse(readFileSync(configPath, 'utf8')).messages.tts.providers['xopc-cloud']).toEqual({ model: 'tts', voice: 'default' });
  expect(existsSync(`${configPath}.cloud-public-models-v1.sqlite.bak`)).toBe(true);
  const again = new AgentCatalogRepository().snapshot();
  bootstrapApplicationStateSync(configPath);
  expect(new AgentCatalogRepository().snapshot()).toEqual(again);
});

it('migrates active sessions, automations and workflows without rewriting history', () => {
  const { stateDir, configPath } = useTempState();
  writeFileSync(configPath, '{}');
  bootstrapApplicationStateSync(configPath);
  const db = getSqliteDatabase();
  db.prepare('DELETE FROM application_migrations WHERE id = ?').run('cloud-public-models-v1');
  const conversationId = '11111111-1111-4111-8111-111111111111';
  ensureSessionRecord(conversationId, stateDir, { agentId: 'main' });
  setSessionConfig(conversationId, { modelOverride: 'xopc-cloud/glm-5', fixedModel: true, thinkingLevel: 'high' }, stateDir);
  db.prepare(`INSERT INTO automations(automation_id,name,enabled,trigger_json,action_json,state_json,delivery_json,created_at_ms,updated_at_ms)
    VALUES('cloud-task','Cloud Task',1,'{"kind":"manual"}',?,'{}','{"notificationPolicy":"attention","destinations":[]}',1,1)`)
    .run(JSON.stringify({ kind: 'agent', model: 'xopc-cloud/deepseek-v4-flash', instruction: 'xopc-cloud/glm-5' }));
  const catalog = createWorkflowCatalog();
  const source = catalog.load(catalog.list()[0]!.name);
  const graph = structuredClone(source.graph);
  const node = graph.nodes.find(item => item.kind === 'agent');
  if (!node || node.kind !== 'agent') throw new Error('Missing fixture Agent');
  node.config.model = 'xopc-cloud/glm-5';
  const { definition } = catalog.save({ name: 'cloud-migration-test', graph, manifest: { title: 'Cloud Migration', tags: ['retained'] } });
  expect(migrateCloudPublicModelsSync(configPath)).toBe(true);
  expect(getSessionConfig(conversationId)).toMatchObject({ modelOverride: 'xopc-cloud/auto', fixedModel: true, thinkingLevel: 'high' });
  expect(JSON.parse((db.prepare("SELECT action_json FROM automations WHERE automation_id='cloud-task'").get() as { action_json: string }).action_json)).toEqual({ kind: 'agent', model: 'xopc-cloud/auto', instruction: 'xopc-cloud/glm-5' });
  const updated = catalog.load('cloud-migration-test');
  expect(updated.revision).toBe(definition.revision + 1);
  expect(updated.contentHash).not.toBe(definition.contentHash);
  expect(updated.metadata.tags).toEqual(['retained']);
  expect(catalog.loadRevision('cloud-migration-test', 1)).toEqual(definition);
  expect(migrateCloudPublicModelsSync(configPath)).toBe(false);
});
