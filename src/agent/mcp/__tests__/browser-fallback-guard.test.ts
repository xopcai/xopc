import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  content: '我需要你帮我查询',
  previous: '帮我查询下麦当劳积分',
  records: [] as Array<Record<string, unknown>>,
}));
vi.mock('../../../storage/sqlite/durable-state.js', () => ({ DurableState: class { values() { return state.records; } } }));
vi.mock('../../../storage/sqlite/session-input-repository.js', () => ({
  findSessionInputByRunId: () => ({ content: state.content, origin: { type: 'endpoint' } }),
}));
vi.mock('../../../storage/sqlite/session-read-repository.js', () => ({ getSessionMetadata: () => ({ transcriptId: 'transcript' }) }));
vi.mock('../../../storage/sqlite/transcript-repository.js', () => ({
  loadRecentUserTranscriptRows: () => [state.content, state.previous].map(content => ({ role: 'user', content })),
}));
vi.mock('../../embedded/execution-context.js', () => ({ getEmbeddedExecutionRunId: () => 'run' }));

import { createMcpBrowserFallbackGuard } from '../browser-fallback-guard.js';

let beforeCall: (event: { toolName: string; input: Record<string, unknown> }) => unknown;
const browser = { toolName: 'browser_use', input: { action: 'navigate' } };
function record(overrides: Record<string, unknown>) {
  state.records.push({ conversationId: 'conversation', transcriptId: 'transcript', runId: 'run',
    name: '麦当劳', expiresAt: Date.now() + 60_000, ...overrides });
}
beforeEach(() => {
  state.content = '我需要你帮我查询';
  state.previous = '帮我查询下麦当劳积分';
  state.records = [];
  createMcpBrowserFallbackGuard('conversation')({ on: (_event: string, handler: typeof beforeCall) => { beforeCall = handler; } } as any);
});

it('blocks browser and page dispatch for the inherited account lookup before discovery', () => {
  expect(beforeCall(browser)).toMatchObject({ block: true, reason: expect.stringContaining('"serviceName":"麦当劳"') });
  expect(beforeCall({ toolName: 'device__web_page_navigate_test', input: {} })).toMatchObject({ block: true });
  expect(beforeCall({ toolName: 'xopc_use', input: { mode: 'browser_setup', command: 'inspect' } })).toMatchObject({ block: true });
  expect(beforeCall({ toolName: 'mcp__mcd__query_my_account', input: {} })).toBeUndefined();
});

it('releases browser fallback only for a current same-service negative result', () => {
  record({ name: 'Unrelated service', outcome: 'no_match' });
  record({ runId: 'old-run', outcome: 'no_match' });
  record({ transcriptId: 'old-transcript', outcome: 'no_match' });
  record({ cancelled: true, outcome: 'no_match' });
  expect(beforeCall(browser)).toMatchObject({ block: true });
  record({ outcome: 'no_match' });
  expect(beforeCall(browser)).toBeUndefined();
});

it.each(['managed', 'references', 'incomplete'])('keeps browser blocked after discovery returns %s', outcome => {
  record({ outcome });
  expect(beforeCall(browser)).toMatchObject({ block: true });
});

it.each(['麦当劳几点开门？', '帮我用浏览器查询麦当劳积分', '我有多少积分？'])('preserves browser dispatch outside a recognized implicit account lookup (%s)', input => {
  state.content = input;
  expect(beforeCall(browser)).toBeUndefined();
});
