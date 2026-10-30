import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { closeXopcDatabase, ensureSessionRecord, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../storage/sqlite/index.js';
import { listSessionMetadata } from '../../../../storage/sqlite/session-repository.js';
import type { SessionListQuery } from '../../../../session/types.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { registerSessionsRoutes } from '../sessions.js';

let dir: string;
let app: Hono;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xopc-sidebar-automations-'));
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(dir, 'xopc.db') });
  app = new Hono();
  registerSessionsRoutes(app, { service: {
    isGatewayReady: () => true,
    projects: { listWithSidebarSessions: () => ({ items: [{ id: 'project-a' }], total: 1, hasMore: false }) },
    sessions: { listSessions: async (query: SessionListQuery) => listSessionMetadata(query) },
  } } as unknown as AuthenticatedRouteDeps);
});
afterEach(() => {
  closeXopcDatabase();
  resetXopcDatabaseSingletonForTest();
  rmSync(dir, { recursive: true, force: true });
});

it('keeps configuration chats in their original lists while excluding active execution transcripts', async () => {
  const seed = (name: string, extra = {}) => ensureSessionRecord(randomUUID(), dir, { agentId: 'main', name, sourceChannel: 'webchat', hiddenFromSessionList: false, ...extra });
  seed('ordinary');
  seed('project-chat', { projectId: 'project-a' });
  seed('pinned-config', { status: 'pinned', customData: { automationSetup: { automationId: 'news' } } });
  seed('project-config', { projectId: 'project-a', customData: { automationSetup: {} } });
  const execution = seed('execution', { sourceChannel: 'automation' });
  const response = await app.request(`/api/sidebar/chat-list?includeConversationId=${execution.key}`);
  expect(response.status).toBe(200);
  const sidebar = await response.json();
  expect(sidebar.inbox.items.map((row: { name: string }) => row.name).sort()).toEqual(['ordinary', 'pinned-config']);
  expect(sidebar.projects.items[0].sessions.map((row: { name: string }) => row.name).sort()).toEqual(['project-chat', 'project-config']);
  expect(sidebar.pinned.map((row: { name: string }) => row.name)).toEqual(['pinned-config']);

  const conversations = await app.request('/api/sessions?excludeAutomationRuns=true');
  expect(conversations.status).toBe(200);
  expect((await conversations.json()).items.map((row: { name: string }) => row.name).sort())
    .toEqual(['ordinary', 'pinned-config', 'project-chat', 'project-config']);
  const runs = await app.request('/api/sessions?purposes=automation');
  expect((await runs.json()).items.map((row: { name: string }) => row.name)).toEqual(['execution']);
});
