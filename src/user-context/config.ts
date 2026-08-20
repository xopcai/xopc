import { z } from 'zod';

import { ResponseLanguageSchema } from '../i18n/response-language.js';

export const UserMemoryModeSchema = z.enum(['off', 'readOnly', 'confirmWrite', 'auto']);

export const DEFAULT_CONTEXT_COMPACTION_POLICY = {
  enabled: true,
  triggerThreshold: 0.8,
  reserveTokens: 8_192,
  minMessagesBeforeCompact: 10,
  keepRecentTokens: 20_000,
  recentTurnsPreserve: 3,
  summaryMaxTokens: 2_000,
  summaryChunkTokens: 24_000,
  summaryTimeoutMs: 180_000,
  summaryRetries: 2,
  qualityGuard: true,
  minToolResultKeepChars: 1_000,
  maxActiveTranscriptBytes: 2_000_000,
  postCompactionSections: ['Session Startup', 'Red Lines'],
};

export const ContextCompactionPolicySchema = z
  .object({
    enabled: z.boolean().default(true),
    triggerThreshold: z.number().min(0.1).max(0.98).default(0.8),
    reserveTokens: z.number().int().min(1_024).default(8_192),
    minMessagesBeforeCompact: z.number().int().min(2).default(10),
    keepRecentTokens: z.number().int().min(1_000).default(20_000),
    recentTurnsPreserve: z.number().int().min(1).max(12).default(3),
    summaryMaxTokens: z.number().int().min(256).default(2_000),
    summaryChunkTokens: z.number().int().min(1_000).default(24_000),
    summaryTimeoutMs: z.number().int().min(1_000).max(600_000).default(180_000),
    summaryRetries: z.number().int().min(0).max(5).default(2),
    qualityGuard: z.boolean().default(true),
    model: z.string().min(1).optional(),
    minToolResultKeepChars: z.number().int().min(200).default(1_000),
    maxActiveTranscriptBytes: z.number().int().min(64_000).default(2_000_000),
    postCompactionSections: z.array(z.string().min(1)).max(12).default(['Session Startup', 'Red Lines']),
  })
  .strict()
  .default(DEFAULT_CONTEXT_COMPACTION_POLICY);

export const UserMemoryConfigSchema = z
  .object({
    mode: UserMemoryModeSchema.default('off'),
    sources: z
      .array(z.enum(['session', 'userProfile', 'agentProfile', 'understanding', 'workspace', 'connectedSources']))
      .default(['session']),
    writePolicy: z
      .object({
        userProfile: z.enum(['deny', 'confirm', 'allow']).optional(),
        agentProfile: z.enum(['deny', 'confirm', 'allow']).optional(),
        understanding: z.enum(['deny', 'confirm', 'allow']).optional(),
        workspace: z.enum(['deny', 'confirm', 'allow']).optional(),
      })
      .strict()
      .optional(),
    retention: z
      .object({
        compaction: ContextCompactionPolicySchema,
        maxAgeDays: z.number().int().positive().optional(),
        maxItems: z.number().int().positive().optional(),
        maxChars: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .default({ mode: 'off', sources: ['session'] });

export const UserUnderstandingConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    adaptiveCadence: z.boolean().default(true),
    reviewIntervalTurns: z.number().int().min(1).max(1_000).default(10),
    maxHistoryMessages: z.number().int().min(1).max(200).default(80),
    maxDurationMs: z.number().int().min(1_000).max(600_000).default(120_000),
  })
  .strict()
  .default({
    enabled: true,
    adaptiveCadence: true,
    reviewIntervalTurns: 10,
    maxHistoryMessages: 80,
    maxDurationMs: 120_000,
  });

export const UserContextPrivacySchema = z
  .object({
    sensitiveWritePolicy: z.enum(['deny', 'confirm', 'allow']).default('confirm'),
  })
  .strict()
  .default({ sensitiveWritePolicy: 'confirm' });

export const UserContextProviderRoutingSchema = z
  .object({
    searchStrategy: z
      .enum(['local-first', 'external-first', 'fanout', 'local-only', 'external-only'])
      .default('fanout'),
    writeStrategy: z
      .enum(['local-first', 'external-first', 'write-through', 'local-only', 'external-only'])
      .default('local-first'),
    allowExternalWrites: z.boolean().default(false),
    allowedProviderIds: z.array(z.string().min(1)).optional(),
    autoWriteKinds: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .default({
    searchStrategy: 'fanout',
    writeStrategy: 'local-first',
    allowExternalWrites: false,
  });

const DreamingIntervalHoursSchema = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4),
  z.literal(6), z.literal(8), z.literal(12), z.literal(24),
]);
const DreamingTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected time in HH:mm format');

export const DreamingScheduleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('interval'),
    everyHours: DreamingIntervalHoursSchema,
    minute: z.number().int().min(0).max(59),
  }).strict(),
  z.object({
    kind: z.literal('daily'),
    time: DreamingTimeSchema,
  }).strict(),
  z.object({
    kind: z.literal('weekly'),
    weekday: z.number().int().min(0).max(6),
    time: DreamingTimeSchema,
  }).strict(),
]);

const DreamingEditablePhaseSchema = z.object({
  enabled: z.boolean(),
  schedule: DreamingScheduleSchema,
}).strict();

export const DreamingSettingsSchema = z.object({
  mode: z.enum(['off', 'observe', 'review', 'automatic']),
  timezone: z.string().min(1).refine(isValidTimeZone, 'Invalid IANA timezone'),
  phases: z.object({
    light: DreamingEditablePhaseSchema,
    deep: DreamingEditablePhaseSchema,
    rem: DreamingEditablePhaseSchema,
  }).strict(),
}).strict();

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const DreamingPhaseSchema = z
  .object({
    enabled: z.boolean().optional(),
    schedule: DreamingScheduleSchema.optional(),
  })
  .strict();

export const UserContextDreamingSchema = z
  .object({
    mode: z.enum(['off', 'observe', 'review', 'automatic']).default('off'),
    timezone: z.string().min(1).refine(isValidTimeZone, 'Invalid IANA timezone').optional(),
    phases: z
      .object({
        light: DreamingPhaseSchema.extend({
          lookbackDays: z.number().int().positive().optional(),
          limit: z.number().int().nonnegative().optional(),
        }).strict().optional(),
        deep: DreamingPhaseSchema.extend({
          minScore: z.number().min(0).max(1).optional(),
          minRecallCount: z.number().int().positive().optional(),
          minUniqueQueries: z.number().int().positive().optional(),
          limit: z.number().int().nonnegative().optional(),
          recencyHalfLifeDays: z.number().positive().optional(),
          maxAgeDays: z.number().positive().optional(),
        }).strict().optional(),
        rem: DreamingPhaseSchema.extend({
          lookbackDays: z.number().int().positive().optional(),
          limit: z.number().int().nonnegative().optional(),
          minPatternStrength: z.number().min(0).max(1).optional(),
        }).strict().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .default({ mode: 'off' });

export const UserContextConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    preferences: z
      .object({
        responseLanguage: ResponseLanguageSchema.default('auto'),
      })
      .strict()
      .default({ responseLanguage: 'auto' }),
    memory: UserMemoryConfigSchema,
    understanding: UserUnderstandingConfigSchema,
    privacy: UserContextPrivacySchema,
    providerRouting: UserContextProviderRoutingSchema,
    dreaming: UserContextDreamingSchema,
  })
  .strict()
  .default({
    enabled: true,
    preferences: { responseLanguage: 'auto' },
    memory: { mode: 'confirmWrite', sources: ['session', 'understanding'], writePolicy: { understanding: 'confirm' } },
    understanding: {
      enabled: true,
      adaptiveCadence: true,
      reviewIntervalTurns: 10,
      maxHistoryMessages: 80,
      maxDurationMs: 120_000,
    },
    privacy: { sensitiveWritePolicy: 'confirm' },
    providerRouting: {
      searchStrategy: 'fanout',
      writeStrategy: 'local-first',
      allowExternalWrites: false,
    },
    dreaming: { mode: 'off' },
  });

export type UserContextConfig = z.infer<typeof UserContextConfigSchema>;
export type DreamingSchedule = z.infer<typeof DreamingScheduleSchema>;
export type DreamingSettings = z.infer<typeof DreamingSettingsSchema>;
