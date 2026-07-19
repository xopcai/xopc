import { describe, expect, it, vi } from 'vitest';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

vi.mock('../../../storage/sqlite/index.js', () => ({
  appendMemoryTraceEvent: vi.fn(),
}));

import { UserContextPlanner } from '../context/planner.js';
import type { MemoryManager } from '../manager.js';
import type { MemoryRecord, MemorySearchResult } from '../types.js';

function result(overrides: Partial<MemoryRecord>, score = 0.8): MemorySearchResult {
  const now = new Date().toISOString();
  const record: MemoryRecord = {
    id: overrides.id ?? 'record-1',
    kind: overrides.kind ?? 'preference',
    status: 'active',
    scope: { agentId: 'main' },
    content: overrides.content ?? 'Prefer concise answers.',
    source: { provider: 'local' },
    confidence: 0.9,
    sensitivity: 'normal',
    explicitness: 'explicit',
    durability: 'durable',
    importance: 0.8,
    disclosurePolicy: 'referenceable',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  return {
    record,
    score,
    snippet: record.content,
    citation: { providerId: 'local', recordId: record.id },
  };
}

describe('UserContextPlanner', () => {
  it('injects relevant context and filters unsafe records', async () => {
    const searchResults = [
      result({ id: 'preference' }),
      result({ id: 'secret', content: 'Token value', sensitivity: 'secret' }),
      result({
        id: 'expired',
        content: 'Old project detail',
        validTo: new Date(Date.now() - 1_000).toISOString(),
      }),
    ];
    const memoryManager = {
      search: vi.fn().mockResolvedValue(searchResults),
      list: vi.fn().mockResolvedValue([]),
    } as unknown as MemoryManager;
    const userMessage = { role: 'user', content: 'How should you answer me?' } as AgentMessage;

    const plan = await new UserContextPlanner().plan({
      memoryManager,
      agentId: 'research',
      sessionKey: 'session-1',
      query: 'answer preference',
      userMessage,
    });

    expect(plan.items.map((item) => item.recordId)).toEqual(['preference']);
    expect(plan.rejected).toEqual(expect.arrayContaining([
      { recordId: 'secret', reason: 'sensitive' },
      { recordId: 'expired', reason: 'expired' },
    ]));
    expect(String(plan.modelMessage.content)).toContain('<user-context>');
    expect(String(plan.modelMessage.content)).toContain('Prefer concise answers.');
    expect(String(plan.modelMessage.content)).not.toContain('Token value');
    expect(memoryManager.search).toHaveBeenCalledWith(expect.objectContaining({
      scope: { agentId: 'research', sessionKey: 'session-1' },
    }));
  });

  it('adds stable collaboration context and excludes a correction target immediately', async () => {
    const stablePreference = result({ id: 'stable', content: 'Prefer decisions with a short rationale.' }).record;
    const wrongPreference = result({ id: 'wrong', content: 'Prefer terse answers.' }).record;
    const memoryManager = {
      search: vi.fn().mockResolvedValue([result(wrongPreference)]),
      list: vi.fn().mockImplementation(({ kind }: { kind?: string }) => (
        kind === 'preference' ? Promise.resolve([stablePreference]) : Promise.resolve([])
      )),
    } as unknown as MemoryManager;

    const plan = await new UserContextPlanner().plan({
      memoryManager,
      agentId: 'main',
      sessionKey: 'session-1',
      query: 'Draft the launch plan.',
      userMessage: { role: 'user', content: 'Draft the launch plan.' } as AgentMessage,
      excludedRecordIds: ['wrong'],
    });

    expect(plan.items.map((item) => item.recordId)).toContain('stable');
    expect(plan.items.map((item) => item.recordId)).not.toContain('wrong');
    expect(String(plan.modelMessage.content)).toContain('The user explicitly shared this');
    expect(String(plan.modelMessage.content)).not.toContain('local:');
  });

  it('does not inject understanding whose periodic review is due', async () => {
    const due = result({
      id: 'due',
      reviewAfter: new Date(Date.now() - 1_000).toISOString(),
    });
    const memoryManager = {
      search: vi.fn().mockResolvedValue([due]),
      list: vi.fn().mockResolvedValue([]),
    } as unknown as MemoryManager;

    const plan = await new UserContextPlanner().plan({
      memoryManager,
      agentId: 'main',
      sessionKey: 'session-1',
      query: 'How should you write?',
      userMessage: { role: 'user', content: 'How should you write?' } as AgentMessage,
    });

    expect(plan.items).toHaveLength(0);
    expect(plan.rejected).toContainEqual({ recordId: 'due', reason: 'needs_review' });
  });
});
