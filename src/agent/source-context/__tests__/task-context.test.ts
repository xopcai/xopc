import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { TaskRepository } from '../../../tasks/task-repository.js';
import { buildTaskAgentContext } from '../task-context.js';
import { buildSessionAgentContext } from '../session-context.js';
import { buildBrowserTabAgentContext } from '../browser-tab.js';
import { buildFileAgentContext } from '../file-context.js';
import { decodeMcpResourceId, encodeMcpResourceId } from '../../mcp/mcp-resource-id.js';
import { isSessionSourceBinding, parseTurnContextRefs } from '../types.js';
import type { FileSpaceService } from '../../../files/file-service.js';

describe('task references', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'task-reference-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
  });
  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(directory, { recursive: true, force: true });
  });
  it('resolves the selected version and refuses missing or changed tasks', () => {
    const task = new TaskRepository().create({ title: 'Launch', objective: 'Ship', body: 'Check rollout' });
    const context = buildTaskAgentContext(task, String(task.version));
    expect(context).toMatchObject({ kind: 'task', sourceId: task.id, version: String(task.version), truncated: false });
    expect(context?.text).toContain('Check rollout');
    expect(context?.text).toContain('Ship');
    expect(buildTaskAgentContext(task, '999')).toBeNull();
    expect(buildTaskAgentContext(undefined)).toBeNull();
    expect(buildTaskAgentContext({ ...task, body: 'x'.repeat(30_000) })?.text.length).toBe(24_000);
    expect(buildTaskAgentContext({ ...task, body: 'x'.repeat(30_000) })?.truncated).toBe(true);
  });
  it('searches stored tasks before limiting and treats SQL wildcard characters literally', () => {
    const tasks = new TaskRepository();
    const match = tasks.create({ title: 'Old 100% plan', objective: 'Ship', body: '会议记录', now: 1 });
    tasks.create({ title: 'Latest', objective: 'Ship', now: 2 });
    expect(tasks.list({ search: '100%', limit: 1 }).map(task => task.id)).toEqual([match.id]);
    expect(tasks.list({ search: '会议' }).map(task => task.id)).toEqual([match.id]);
    expect(tasks.list({ search: 'OLD' }).map(task => task.id)).toEqual([match.id]);
    expect(tasks.list({ search: "' OR 1=1 --" })).toEqual([]);
  });
  it('accepts per-turn task references without creating persistent task bindings', () => {
    expect(parseTurnContextRefs([{ kind: 'task', sourceId: ' t ', expectedVersion: '2' }]))
      .toEqual([{ kind: 'task', sourceId: 't', expectedVersion: '2' }]);
    expect(parseTurnContextRefs([
      { kind: 'file', sourceId: ' f ', expectedVersion: '3' },
      { kind: 'session', sourceId: ' s ', expectedVersion: '4' },
      { kind: 'browser_tab', sourceId: ' b ', expectedVersion: '5' },
      { kind: 'mcp_resource', sourceId: ' m ', expectedVersion: '6' },
    ])).toEqual([
      { kind: 'file', sourceId: 'f', expectedVersion: '3' },
      { kind: 'session', sourceId: 's', expectedVersion: '4' },
      { kind: 'browser_tab', sourceId: 'b', expectedVersion: '5' },
      { kind: 'mcp_resource', sourceId: 'm', expectedVersion: '6' },
    ]);
    expect(isSessionSourceBinding({ kind: 'task', sourceId: 't', version: '2', attachedAt: 1 })).toBe(false);
  });

  it('freezes a bounded user and assistant transcript at the selected session version', () => {
    const metadata = { key: 'session-1', name: 'Launch chat', updatedAt: '2026-09-22T00:00:00Z' };
    const context = buildSessionAgentContext(metadata, [
      { role: 'system', content: 'hidden' },
      { role: 'user', content: 'What changed?' },
      { role: 'assistant', content: [{ type: 'text', text: 'The launch date.' }] },
    ], metadata.updatedAt);
    expect(context).toMatchObject({
      kind: 'session', sourceId: 'session-1', version: metadata.updatedAt, title: 'Launch chat',
    });
    expect(context?.text).toBe('user: What changed?\n\nassistant: The launch date.');
    expect(buildSessionAgentContext(metadata, [], 'stale')).toBeNull();
  });

  it('preserves opaque MCP identities and rejects stale browser documents', () => {
    const resource = { serverId: 'docs', uri: 'file:///launch plan.md' };
    expect(decodeMcpResourceId(encodeMcpResourceId(resource))).toEqual(resource);
    expect(decodeMcpResourceId('invalid')).toBeNull();

    const observation = {
      sessionId: 'browser-session', tabId: '7', revision: 1, documentId: 'doc-1',
      url: 'https://example.com/launch', title: 'Launch', nodes: [],
      changes: { added: [], changed: [], removed: [] },
    };
    expect(buildBrowserTabAgentContext('binding-1', observation, 'doc-1')).toMatchObject({
      kind: 'browser_tab', sourceId: 'binding-1', version: 'doc-1', title: 'Launch',
    });
    expect(buildBrowserTabAgentContext('binding-1', observation, 'doc-2')).toBeNull();
  });

  it('preserves directory identity in a frozen file context', async () => {
    const files = {
      resource: async () => ({
        space: { id: 'space-1' },
        resource: {
          kind: 'directory', spaceId: 'space-1', revision: '7', relativePath: 'apps/mobile-expo',
          name: 'mobile-expo',
        },
        absolutePath: '/workspace/apps/mobile-expo',
      }),
      children: async () => [],
    } as unknown as FileSpaceService;

    await expect(buildFileAgentContext(files, 'folder-1', '7', 'space-1')).resolves.toMatchObject({
      kind: 'file', fileKind: 'directory', sourceId: 'folder-1', title: 'apps/mobile-expo',
    });
    await expect(buildFileAgentContext(files, 'folder-1', '7', 'other-space')).resolves.toBeNull();
  });
});
