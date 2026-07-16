import { describe, expect, it, vi } from 'vitest';

import {
  extractExplicitUnderstandingCandidates,
  UserUnderstandingService,
} from '../understanding/service.js';

describe('UserUnderstandingService', () => {
  it('extracts an explicit preference with policy metadata', () => {
    const candidates = extractExplicitUnderstandingCandidates(
      'Please remember that I prefer pnpm over npm for this repo.',
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: 'preference',
      content: 'I prefer pnpm over npm for this repo.',
      explicitness: 'explicit',
      durability: 'durable',
      sensitivity: 'normal',
    });
    expect(candidates[0]?.canonicalKey).toMatch(/^preference:/);
  });

  it('ignores ordinary turns without explicit memory intent', () => {
    expect(extractExplicitUnderstandingCandidates('Can you explain the gateway routes?')).toEqual([]);
  });

  it('creates a review candidate linked to the single corrected record', async () => {
    const write = vi.fn().mockResolvedValue({ success: true, record: { id: 'replacement' } });
    const service = new UserUnderstandingService({ write, list: vi.fn().mockResolvedValue([]) });

    await service.applyCandidates(extractExplicitUnderstandingCandidates(
      '你记错了我的偏好，我更喜欢详细解释。',
    ), {
      supersedesRecordIds: ['old-preference'],
    });

    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      content: '我更喜欢详细解释。',
      status: 'candidate',
      supersedesRecordId: 'old-preference',
      tags: expect.arrayContaining(['explicit-user-correction']),
    }));
  });

  it('deduplicates by canonical key before writing', async () => {
    const write = vi.fn();
    const list = vi.fn().mockResolvedValue([{
      id: 'existing',
      kind: 'preference',
      scope: { agentId: 'main' },
      content: 'Prefer concise answers.',
      source: {},
      explicitness: 'explicit',
      durability: 'durable',
      importance: 0.8,
      disclosurePolicy: 'referenceable',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]);
    const service = new UserUnderstandingService({ write, list });
    const result = await service.applyCandidates([{
      kind: 'preference',
      content: 'Prefer concise answers.',
      canonicalKey: 'preference:concise',
      confidence: 0.9,
      importance: 0.8,
      explicitness: 'explicit',
      durability: 'durable',
      sensitivity: 'normal',
      disclosurePolicy: 'referenceable',
    }], {});

    expect(result).toMatchObject({ proposed: 1, created: 0, deduplicated: 1, rejected: 0 });
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects secret candidates before provider writes', async () => {
    const write = vi.fn();
    const service = new UserUnderstandingService({ write, list: vi.fn().mockResolvedValue([]) });
    const result = await service.applyCandidates([{
      kind: 'agent_note',
      content: 'API key is abcdefgh.',
      confidence: 0.9,
      importance: 0.9,
      explicitness: 'explicit',
      durability: 'durable',
      sensitivity: 'secret',
      disclosurePolicy: 'ask_before_reference',
    }], {});

    expect(result.rejected).toBe(1);
    expect(write).not.toHaveBeenCalled();
  });

  it('reclassifies model-mislabeled secret content before provider writes', async () => {
    const write = vi.fn();
    const service = new UserUnderstandingService({ write, list: vi.fn().mockResolvedValue([]) });
    const result = await service.applyCandidates([{
      kind: 'agent_note',
      content: 'My API key is sk-abcdefghijk.',
      confidence: 0.9,
      importance: 0.9,
      explicitness: 'inferred',
      durability: 'durable',
      sensitivity: 'normal',
      disclosurePolicy: 'silent',
    }], {});

    expect(result.rejected).toBe(1);
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects regulated candidates and redacts secrets from accepted evidence', async () => {
    const write = vi.fn().mockResolvedValue({ success: true });
    const service = new UserUnderstandingService({ write, list: vi.fn().mockResolvedValue([]) });
    const result = await service.applyCandidates([{
      kind: 'personal_logistics',
      content: 'My bank account is 12345678.',
      confidence: 0.9,
      importance: 0.8,
      explicitness: 'inferred',
      durability: 'durable',
      sensitivity: 'normal',
      disclosurePolicy: 'ask_before_reference',
    }, {
      kind: 'preference',
      content: 'Prefer concise status updates.',
      confidence: 0.9,
      importance: 0.8,
      explicitness: 'inferred',
      durability: 'durable',
      sensitivity: 'normal',
      disclosurePolicy: 'referenceable',
    }], {
      sourceText: 'Prefer concise status updates. token=should-not-be-stored',
    });

    expect(result).toMatchObject({ proposed: 2, created: 1, rejected: 1 });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0].tags).toContain('user-understanding');
    expect(write.mock.calls[0]?.[0].evidence[0].sourceText).toContain('token=[REDACTED]');
    expect(write.mock.calls[0]?.[0].evidence[0].sourceText).not.toContain('should-not-be-stored');
  });
});
