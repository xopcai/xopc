import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { openXopcDatabase, closeXopcDatabase } from '../../../storage/sqlite/connection.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { resetSessionRecord } from '../../../storage/sqlite/session-repository.js';
import { appendTranscriptEntry } from '../../../storage/sqlite/transcript-repository.js';
import { DurableState } from '../../../storage/sqlite/durable-state.js';
import { McpDiscovery } from '../discovery.js';

let root: string, conversationId: string, discovery: McpDiscovery;
const research = { search: vi.fn(), read: vi.fn() };
const authorizeResearch = vi.fn(async () => true);
const guide = 'Service guide: streamable HTTP https://service.example/mcp Authorization: Bearer TOKEN. Get a Token from https://service.example/keys';
const context = () => ({ conversationId, agentId: 'main', authorizeResearch });
beforeEach(() => {
  vi.clearAllMocks(); root = mkdtempSync(join(tmpdir(), 'xopc-mcp-discovery-')); vi.stubEnv('XOPC_STATE_DIR', root);
  openXopcDatabase({ path: join(root, 'xopc.db') }); initializeTestAgentCatalog({ agents: [{ id: 'main', workspace: root }] });
  conversationId = createConversation({ agentId: 'main', sourceChannel: 'webchat' }).key;
  research.search.mockResolvedValue([{ title: 'Guide', url: 'https://service.example/guide' }]);
  research.read.mockResolvedValue({ url: 'https://service.example/guide', text: guide }); authorizeResearch.mockResolvedValue(true);
  discovery = new McpDiscovery(research);
});
afterEach(() => { closeXopcDatabase(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
async function discover() { return await discovery.command('discover', { serviceName: 'New service', purpose: 'Connect only' }, context()) as any; }
async function propose(result: any, url = 'https://service.example/mcp') {
  return await discovery.command('propose', { discoveryId: result.discoveryId, expectedVersion: result.version,
    plan: { displayName: 'New service', url, transport: 'streamable-http', authentication: 'bearer', objective: 'connect_only', helpUrl: 'https://service.example/keys' },
    evidence: [{ documentId: result.documents[0].id, quote: guide }] }, context()) as any;
}
it('discovers from a name and binds a selected plan to exact source quotes, versions and conversation', async () => {
  const found = await discover(); expect(research.search).toHaveBeenCalledWith(expect.stringContaining('New service'), expect.any(AbortSignal));
  const proposed = await propose(found); expect(proposed.candidates[0].ownership).toBe('owner_review_required');
  const selected = await discovery.command('select', { discoveryId: found.discoveryId, expectedVersion: proposed.version, candidateId: proposed.candidates[0].candidateId }, context()) as any;
  expect(discovery.selected(selected.planId, selected.expectedPlanVersion, context())).toMatchObject({ plan: { url: 'https://service.example/mcp', objective: 'connect_only' }, trusted: false, sources: [{ url: 'https://service.example/guide' }] });
  expect(() => discovery.selected(selected.planId, selected.expectedPlanVersion, { ...context(), conversationId: createConversation({ agentId: 'main' }).key })).toThrow('another conversation');
  resetSessionRecord(conversationId, root);
  expect(() => discovery.selected(selected.planId, selected.expectedPlanVersion, context())).toThrow('expired');
});
it('does not search through a denied permission or follow a search result into a private source', async () => {
  authorizeResearch.mockResolvedValueOnce(false); await expect(discover()).rejects.toThrow('permission'); expect(research.search).not.toHaveBeenCalled();
  research.search.mockResolvedValueOnce([{ url: 'http://169.254.169.254/credentials', title: 'Fake guide' }]);
  expect(await discover()).toMatchObject({ documents: [], failures: [{ reason: 'non_public_source' }] }); expect(research.read).not.toHaveBeenCalled();
});
it('rejects invented endpoints, private candidates, stale versions and fabricated source quotes', async () => {
  const found = await discover(); await expect(propose(found, 'https://steal.example/mcp')).rejects.toThrow('exact document evidence');
  await expect(discovery.command('propose', { discoveryId: found.discoveryId, expectedVersion: found.version, plan: { displayName: 'Fake', url: 'http://127.0.0.1:80', objective: 'connect_only' }, evidence: [{ documentId: found.documents[0].id, quote: 'invented' }] }, context())).rejects.toThrow('quote');
  const proposed = await propose(found); await expect(propose(found)).rejects.toThrow('changed');
  await expect(discovery.command('select', { discoveryId: found.discoveryId, expectedVersion: proposed.version, candidateId: '00000000-0000-4000-8000-000000000000' }, context())).rejects.toThrow('Unknown candidate');
});
it('requires a new user reply before choosing among multiple proposed candidates', async () => {
  const found = await discover(); const first = await propose(found); const second = await propose({ ...found, version: first.version });
  const args = { discoveryId: found.discoveryId, expectedVersion: second.version, candidateId: second.candidates[0].candidateId };
  await expect(discovery.command('select', args, context())).rejects.toThrow('new user reply');
  appendTranscriptEntry(conversationId, { role: 'user', content: 'Use the first one', timestamp: Date.now() });
  expect(await discovery.command('select', args, context())).toHaveProperty('planId');
});
it('does not resurrect evidence after cancellation while a source is loading', async () => {
  let release!: () => void;
  research.read.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return { url: 'https://service.example/guide', text: guide }; });
  const pending = discover(); const rejection = expect(pending).rejects.toThrow('expired');
  await vi.waitFor(() => expect(release).toBeTypeOf('function')); discovery.cancelConversation(conversationId); release(); await rejection;
});

it.each(['麦当劳', 'McDonald’s', 'New service'])('uses only actual search results for %s, without vendor-specific source injection', async serviceName => {
  await discovery.command('discover', { serviceName, purpose: 'Connect only' }, context());
  expect(research.read).toHaveBeenCalledTimes(1);
  expect(research.read).toHaveBeenCalledWith('https://service.example/guide', expect.any(AbortSignal));
});

it('requires owner review even for the previously hardcoded publisher and endpoint', async () => {
  const text = 'Official integration: https://mcp.mcd.cn Authorization: Bearer TOKEN';
  research.search.mockResolvedValueOnce([{ title: 'Official guide', url: 'https://github.com/M-China/mcd-mcp-server' }]);
  research.read.mockResolvedValueOnce({ url: 'https://github.com/M-China/mcd-mcp-server', text });
  const found = await discovery.command('discover', { serviceName: '麦当劳', purpose: 'Connect only' }, context()) as any;
  const proposed = await discovery.command('propose', { discoveryId: found.discoveryId, expectedVersion: found.version,
    plan: { displayName: '麦当劳', url: 'https://mcp.mcd.cn', authentication: 'bearer', objective: 'connect_only' },
    evidence: [{ documentId: found.documents[0].id, quote: text }] }, context()) as any;
  expect(proposed.candidates[0].ownership).toBe('owner_review_required');
});

it('does not reuse a persisted trust flag from the removed service-specific rules', async () => {
  const found = await discover(), proposed = await propose(found);
  const selected = await discovery.command('select', { discoveryId: found.discoveryId, expectedVersion: proposed.version, candidateId: proposed.candidates[0].candidateId }, context()) as any;
  const records = new DurableState<any>('mcp.discovery');
  const record = records.get(found.discoveryId)!;
  record.candidates[0].trusted = true;
  records.set(record.id, record);
  expect(discovery.selected(selected.planId, selected.expectedPlanVersion, context()).trusted).toBe(false);
});
