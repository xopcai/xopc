import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { personalAgentId } from '../../../personal-agent/repository.js';
import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { AgentSelectionRepository } from '../../../agent-matching/selection-repository.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase } from '../../../storage/sqlite/index.js';
import { TaskRepository } from '../../../tasks/task-repository.js';
import { AgentToolsFactory } from '../factory.js';
import type { MessageBus } from '../../../infra/bus/index.js';
import { createPersonalTaskTool } from '../personal-task-tool.js';

vi.mock('../../../personal-agent/specialist-capabilities.js', () => ({
  getAvailablePersonalAgentTools: () => ['read_file'], personalAgentModelAvailability: () => ({ available: true }),
}));
const ownAgentId = personalAgentId('local-owner');
let conversationId: string;
let catalog: ReturnType<typeof initializeTestAgentCatalog>;
beforeEach(() => {
  catalog = initializeTestAgentCatalog({ agents: [{ id: ownAgentId }, { id: 'reader' }] });
  conversationId = createConversation({ agentId: ownAgentId, customData: { personalAgent: true } }, '/tmp').key;
});
afterEach(() => closeXopcDatabase());
function tool() {
  return createPersonalTaskTool({ getCurrentConversationId: () => conversationId,
    getCurrentAgentId: () => ownAgentId, dispatchTaskRuns: vi.fn(),
    getAgentToolAvailability: (_id, name) => ({ condition: `tool:${name}`, state: 'verified', reasonCode: 'registered' }) });
}
const read = (result: { content: unknown[] }) => JSON.parse((result.content[0] as { text: string }).text);

describe('Personal task matching and diagnostics', () => {
  it('records only displayed match candidates and preserves matching requirements', async () => {
    const personal = tool();
    const requirements = { summary: 'Read document', requiredTools: ['read_file'] };
    const matched = read(await personal.execute('match', { command: 'match', requirements }));
    await personal.execute('create', { command: 'create', objective: 'Read document', agentId: 'reader', requirements,
      matchId: matched.matchId, idempotencyKey: 'matched', selectionReason: 'Can read the supplied document' });
    const task = new TaskRepository().list()[0]!;
    const records = read(await personal.execute('choices', { command: 'selection', taskId: task.id }));
    expect(records.items[0]).toMatchObject({ selectionSource: 'match', selectionReason: 'Can read the supplied document' });
    expect(records.items[0]).not.toHaveProperty('candidates');
    expect(new AgentSelectionRepository().list(conversationId)[0].candidates!.map(candidate => candidate.id)).toEqual(matched.candidates.map((candidate: { id: string }) => candidate.id));
    await expect(personal.execute('changed', { command: 'create', objective: 'Read', agentId: 'reader',
      requirements: { summary: 'Different' }, matchId: matched.matchId })).rejects.toThrow('preserve');
  });

  it('recovers a committed match creation after tool recreation and capability changes', async () => {
    const personal = tool();
    const requirements = { summary: 'Read document' };
    const match = read(await personal.execute('match', { command: 'match', requirements }));
    const input = { command: 'create' as const, agentId: 'reader', objective: 'Read document', requirements,
      matchId: match.matchId, idempotencyKey: 'retry' };
    await personal.execute('create', input);
    catalog.update('reader', catalog.get('reader')!.revision, { id: 'reader', enabled: false });
    await tool().execute('retry', input);
    expect(new TaskRepository().list()).toHaveLength(1);
    expect(new AgentSelectionRepository().list(conversationId)).toHaveLength(1);
  });

  it('checks the candidate tool registration independently of the personal chat boundary', async () => {
    const factory = new AgentToolsFactory({ workspace: '/tmp', bus: {} as MessageBus, dispatchTaskRuns: vi.fn(),
      getCurrentContext: () => ({ channel: 'webchat', chatId: 'owner', conversationId, origin: { type: 'local' } }) as any });
    const personal = factory.createAllTools({ agentId: ownAgentId, conversationId }).find(item => item.name === 'personal_task')!;
    expect(personal.description).toContain('Use requirements.requestedAgentId only for an explicitly named executor');
    const result = read(await personal.execute('match', { command: 'match', requirements: { summary: 'Read file', requiredTools: ['read_file'] } }));
    expect(result.candidates.find((item: { id: string }) => item.id === 'reader').checks)
      .toContainEqual(expect.objectContaining({ condition: 'tool:read_file', state: 'verified', reasonCode: 'tool_registered' }));
  });

  it('records rejected choices and prevents another conversation from reading them', async () => {
    catalog.update('reader', catalog.get('reader')!.revision, { id: 'reader', enabled: false });
    const personal = tool();
    await expect(personal.execute('reject', { command: 'create', agentId: 'reader', objective: 'Read', idempotencyKey: 'reject' })).rejects.toThrow('unavailable');
    expect(new AgentSelectionRepository().list(conversationId)[0]?.status).toBe('rejected');
    expect(new TaskRepository().list()).toHaveLength(0);
    await expect(personal.execute('foreign', { command: 'selection', taskId: 'foreign' })).rejects.toThrow('belong');
  });
});
