import { describe, expect, it } from 'vitest';

import { ConfigSchema, type Config } from '../../../config/schema.js';
import { isMemorySubsystemEnabled } from '../memory-config.js';
import { resolveCompactionPolicy } from '../compaction-policy.js';

function config(input: Record<string, unknown> = {}): Config {
  return ConfigSchema.parse(input);
}

describe('memory-config', () => {
  it('uses global and knowledge-memory enablement', () => {
    expect(isMemorySubsystemEnabled(undefined)).toBe(true);
    expect(isMemorySubsystemEnabled(config())).toBe(true);
    expect(isMemorySubsystemEnabled(config({ userContext: { enabled: false } }))).toBe(false);
    expect(isMemorySubsystemEnabled(config({
      userContext: { knowledgeMemory: { enabled: false } },
    }))).toBe(false);
  });

  it('preserves an explicit generation limit instead of silently raising it', () => {
    expect(resolveCompactionPolicy(config({ userContext: { contextPlanning: { compaction: { summaryMaxTokens: 2_000 } } } })))
      .toMatchObject({ summaryMaxTokens: 2_000 });
  });

  it('uses the strict context-planning compaction policy', () => {
    const parsed = config({
      userContext: {
        contextPlanning: {
          compaction: { triggerThreshold: 0.7, reserveTokens: 12_000 },
        },
      },
    });
    expect(resolveCompactionPolicy(parsed)).toMatchObject({
      triggerThreshold: 0.7,
      reserveTokens: 12_000,
      keepRecentTokens: 20_000,
      summaryMaxTokens: 16_000,
      reasoningLevel: 'off',
    });
    expect(ConfigSchema.safeParse({ userContext: { contextPlanning: { compaction: true } } }).success)
      .toBe(false);
  });

  it('requires historical memory fields to be migrated before runtime parsing', () => {
    expect(ConfigSchema.safeParse({
      userContext: { knowledgeMemory: { sources: ['session', 'workspace'] } },
    }).success).toBe(false);
    expect(ConfigSchema.safeParse({
      userContext: { userModel: { writePolicy: 'confirm' } },
    }).success).toBe(false);
    expect(ConfigSchema.parse({}).userContext.userModel.writePolicy).toBe('allow');
    expect(ConfigSchema.parse(undefined).userContext.knowledgeMemory.writePolicy).toBe('allow');
  });
});
