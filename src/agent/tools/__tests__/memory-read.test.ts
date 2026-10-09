import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeKnowledgeItem } from '../../../knowledge-memory/index.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { applyUserProfilePatch } from '../../../user-model/profile.js';
import { createKnowledgeReadTool } from '../knowledge-memory-tool.js';
import { createUserContextReadTool } from '../user-context-tool.js';

beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); });
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });
const options = { agentId: 'main', workspaceId: '/workspace', getSessionId: () => 'current', getProjectId: () => 'atlas',
  canRead: () => true, canWrite: () => false, getWritePolicy: () => 'deny' as const,
  getReadPolicy: () => ({ scopes: ['project' as const], contentSources: ['memory' as const] }) };
const parse = (result: Awaited<ReturnType<ReturnType<typeof createKnowledgeReadTool>['execute']>>) => JSON.parse(result.content.find(part => part.type === 'text')!.text);

describe('combined memory reads', () => {
  it('retains user assertion identity, scope and provenance and honors disabled reads', async () => {
    applyUserProfilePatch({ callName: 'Alice' });
    const tool = createUserContextReadTool(options);
    const search = parse(await tool.execute('search', { command: 'search', query: 'Alice' }));
    const detail = parse(await tool.execute('get', { command: 'get', id: search.results[0].id }));
    expect(detail.assertion.value).toBe('Alice');
    expect(detail.slot.scope).toEqual({ type: 'global' });
    expect(detail.sources).toBeInstanceOf(Array);
    const blocked = createUserContextReadTool({ ...options, canRead: () => false });
    expect((await blocked.execute('get', { command: 'get', id: search.results[0].id })).details).toMatchObject({ error: 'user_context_disabled' });
    expect((await createUserContextReadTool(options, command => command !== 'get').execute('get', { command: 'get', id: search.results[0].id })).details)
      .toMatchObject({ error: 'tool_disabled' });
  });

  it('keeps project visibility, source policy and freshness on both commands', async () => {
    for (const [projectId, expiresAt] of [['atlas', undefined], ['other', undefined], ['atlas', 1]] as const) {
      writeKnowledgeItem({ kind: 'decision', scope: { type: 'project', id: projectId }, content: 'Atlas release Friday',
        canonicalKey: `${projectId}-${expiresAt}`, confidence: 1, importance: 0.8, originClass: 'owner', status: 'active', expiresAt });
    }
    const tool = createKnowledgeReadTool(options);
    const search = parse(await tool.execute('search', { command: 'search', query: 'Atlas' }));
    expect(search.results).toHaveLength(1);
    const detail = parse(await tool.execute('get', { command: 'get', id: search.results[0].id }));
    expect(detail.scope).toEqual({ type: 'project', id: 'atlas' });
    expect(detail.source).toBeDefined();
    const blocked = createKnowledgeReadTool({ ...options, getReadPolicy: () => ({ scopes: [], contentSources: [] }) });
    expect((await blocked.execute('get', { command: 'get', id: detail.id })).details).toMatchObject({ error: 'knowledge_not_found' });
  });

  it('delegates oversized data without placing it in text or details', async () => {
    const item = writeKnowledgeItem({ kind: 'decision', scope: { type: 'project', id: 'atlas' }, content: 'private-large-data'.repeat(1000),
      canonicalKey: 'large', confidence: 1, importance: 0.8, originClass: 'owner', status: 'active' }).item;
    const result = await createKnowledgeReadTool(options).execute('get', { command: 'get', id: item.id });
    expect(result.details).toMatchObject({ requiresSpecialist: true, complete: false });
    expect(JSON.stringify(result)).not.toContain('private-large-data');
    expect(parse(result).id).toBe(item.id);
  });

  it('rejects incomplete arguments instead of starting a read', async () => {
    expect((await createKnowledgeReadTool(options).execute('missing', { command: 'search' })).details).toMatchObject({ error: 'invalid_read_arguments' });
  });
});
