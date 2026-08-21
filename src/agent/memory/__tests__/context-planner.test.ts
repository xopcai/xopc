import { describe, expect, it, vi } from 'vitest';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

vi.mock('../../../storage/sqlite/index.js', () => ({
  appendMemoryTraceEvent: vi.fn(),
  consumeMemoryReferenceConsent: vi.fn().mockReturnValue(false),
  ensureMemoryReferenceConsentRequest: vi.fn().mockImplementation(({ recordId, purpose }) => ({ id: `consent:${recordId}`, recordId, purpose })),
  hasMemoryReferenceConsent: vi.fn().mockReturnValue(false),
  hasUnresolvedMemoryConflict: vi.fn().mockReturnValue(false),
}));

import { consumeMemoryReferenceConsent, hasMemoryReferenceConsent, hasUnresolvedMemoryConflict } from '../../../storage/sqlite/index.js';
import { isUserSelfSummaryQuery, UserContextPlanner } from '../context/planner.js';
import type { MemoryManager } from '../manager.js';
import type { MemoryRecord, MemorySearchResult } from '../types.js';

function result(overrides: Partial<MemoryRecord>, score = 0.8): MemorySearchResult {
  const now = new Date().toISOString();
  const record: MemoryRecord = {
    id: overrides.id ?? 'record-1',
    providerId: 'local',
    kind: overrides.kind ?? 'preference',
    status: 'active',
    scope: { userId: 'local-owner' },
    provenance: { sourceAgentId: 'main' },
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
  it.each([
    '介绍下你认知的我',
    '说说你眼中的我',
    '关于我你知道什么？',
    'What do you know about me?',
    'Tell me what you know about me.',
    'Describe me based on what you remember.',
  ])('recognizes an explicit self-summary request: %s', (query) => {
    expect(isUserSelfSummaryQuery(query)).toBe(true);
  });

  it('does not classify an ordinary personalized task as a self-summary', () => {
    expect(isUserSelfSummaryQuery('按照我的偏好写一份发布计划')).toBe(false);
  });

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
      scope: { userId: 'local-owner', sessionKey: 'session-1' },
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

  it('recalls inferred user understanding for an explicit self-summary', async () => {
    const inferred = result({
      id: 'inferred-profile',
      kind: 'derived_insight',
      content: 'Often prefers to understand the mechanism before choosing a solution.',
      explicitness: 'inferred',
      importance: 0.55,
      confidence: 0.65,
      tags: ['user-understanding'],
    }).record;
    const memoryManager = {
      search: vi.fn().mockResolvedValue([]),
      list: vi.fn().mockImplementation(({ kind }: { kind?: string }) => (
        kind === 'derived_insight' ? Promise.resolve([inferred]) : Promise.resolve([])
      )),
    } as unknown as MemoryManager;

    const plan = await new UserContextPlanner().plan({
      memoryManager,
      agentId: 'main',
      sessionKey: 'session-1',
      query: '介绍下你认知的我',
      userMessage: { role: 'user', content: '介绍下你认知的我' } as AgentMessage,
    });

    expect(plan.items.map((item) => item.recordId)).toEqual(['inferred-profile']);
    expect(String(plan.modelMessage.content)).toContain('An inference that may be wrong');
  });

  it('keeps low-importance inferred understanding out of ordinary tasks', async () => {
    const inferred = result({
      id: 'inferred-profile',
      kind: 'derived_insight',
      explicitness: 'inferred',
      importance: 0.55,
      tags: ['user-understanding'],
    }).record;
    const memoryManager = {
      search: vi.fn().mockResolvedValue([]),
      list: vi.fn().mockResolvedValue([inferred]),
    } as unknown as MemoryManager;

    const plan = await new UserContextPlanner().plan({
      memoryManager,
      agentId: 'main',
      sessionKey: 'session-1',
      query: 'Draft a launch plan.',
      userMessage: { role: 'user', content: 'Draft a launch plan.' } as AgentMessage,
    });

    expect(plan.items).toHaveLength(0);
  });

  it('still requires disclosure consent during a self-summary', async () => {
    const guarded = result({
      id: 'guarded-profile',
      kind: 'user_profile',
      disclosurePolicy: 'ask_before_reference',
    }).record;
    const memoryManager = {
      search: vi.fn().mockResolvedValue([]),
      list: vi.fn().mockImplementation(({ kind }: { kind?: string }) => (
        kind === 'user_profile' ? Promise.resolve([guarded]) : Promise.resolve([])
      )),
    } as unknown as MemoryManager;

    const plan = await new UserContextPlanner().plan({
      memoryManager,
      agentId: 'main',
      sessionKey: 'session-1',
      query: '介绍下你认知的我',
      userMessage: { role: 'user', content: '介绍下你认知的我' } as AgentMessage,
    });

    expect(plan.items).toHaveLength(0);
    expect(plan.rejected).toContainEqual({ recordId: 'guarded-profile', reason: 'requires_consent' });
    expect(String(plan.modelMessage.content)).not.toContain(guarded.content);
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

  it('does not inject a disabled playbook rule', async () => {
    const disabled = result({ id: 'disabled', tags: ['playbook:disabled'] });
    const memoryManager = {
      search: vi.fn().mockResolvedValue([disabled]),
      list: vi.fn().mockResolvedValue([]),
    } as unknown as MemoryManager;
    const plan = await new UserContextPlanner().plan({
      memoryManager,
      agentId: 'main',
      sessionKey: 'session-1',
      query: 'Draft a response.',
      userMessage: { role: 'user', content: 'Draft a response.' } as AgentMessage,
    });
    expect(plan.items).toHaveLength(0);
    expect(plan.rejected).toContainEqual({ recordId: 'disabled', reason: 'disabled' });
  });

  it('requests explicit consent and injects the record only after a grant', async () => {
    const guarded = result({ id: 'guarded', disclosurePolicy: 'ask_before_reference' });
    const memoryManager = {
      search: vi.fn().mockResolvedValue([guarded]),
      list: vi.fn().mockResolvedValue([]),
    } as unknown as MemoryManager;
    const planner = new UserContextPlanner();
    const input = {
      memoryManager,
      agentId: 'main',
      sessionKey: 'session-1',
      query: 'How should you answer?',
      userMessage: { role: 'user', content: 'How should you answer?' } as AgentMessage,
    };

    const pending = await planner.plan(input);
    expect(pending.items).toHaveLength(0);
    expect(pending.consentRequests).toEqual([{
      id: 'consent:guarded',
      recordId: 'guarded',
      statement: 'Prefer concise answers.',
      purpose: 'How should you answer?',
    }]);
    expect(String(pending.modelMessage.content)).not.toContain('Prefer concise answers.');

    vi.mocked(hasMemoryReferenceConsent).mockReturnValueOnce(true);
    vi.mocked(consumeMemoryReferenceConsent).mockReturnValueOnce(true);
    const granted = await planner.plan(input);
    expect(granted.items.map((item) => item.recordId)).toEqual(['guarded']);
    expect(granted.consentRequests).toHaveLength(0);
  });

  it('never injects an unresolved conflict', async () => {
    vi.mocked(hasUnresolvedMemoryConflict).mockReturnValueOnce(true);
    const memoryManager = {
      search: vi.fn().mockResolvedValue([result({ id: 'conflicted', conflictGroupId: 'group-1' })]),
      list: vi.fn().mockResolvedValue([]),
    } as unknown as MemoryManager;
    const plan = await new UserContextPlanner().plan({
      memoryManager,
      agentId: 'main',
      sessionKey: 'session-1',
      query: 'Help me decide.',
      userMessage: { role: 'user', content: 'Help me decide.' } as AgentMessage,
    });
    expect(plan.items).toHaveLength(0);
    expect(plan.rejected).toContainEqual({ recordId: 'conflicted', reason: 'conflict' });
  });
});
