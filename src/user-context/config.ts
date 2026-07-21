import { z } from 'zod';

export const UserMemoryModeSchema = z.enum(['off', 'readOnly', 'confirmWrite', 'auto']);

export const UserMemoryConfigSchema = z
  .object({
    mode: UserMemoryModeSchema.default('off'),
    sources: z
      .array(z.enum(['session', 'userProfile', 'agentProfile', 'curated', 'workspace', 'connectedSources']))
      .default(['session']),
    writePolicy: z
      .object({
        userProfile: z.enum(['deny', 'confirm', 'allow']).optional(),
        agentProfile: z.enum(['deny', 'confirm', 'allow']).optional(),
        curated: z.enum(['deny', 'confirm', 'allow']).optional(),
        workspace: z.enum(['deny', 'confirm', 'allow']).optional(),
      })
      .strict()
      .optional(),
    retention: z
      .object({
        compaction: z.boolean().default(true),
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

const DreamingPhaseSchema = z
  .object({
    enabled: z.boolean().optional(),
    cron: z.string().min(1).optional(),
  })
  .strict();

export const UserContextDreamingSchema = z
  .object({
    enabled: z.boolean().default(false),
    frequency: z.string().min(1).optional(),
    timezone: z.string().optional(),
    phases: z
      .object({
        light: DreamingPhaseSchema.extend({
          lookbackDays: z.number().int().positive().optional(),
          limit: z.number().int().nonnegative().optional(),
          dedupeSimilarity: z.number().min(0).max(1).optional(),
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
  .default({ enabled: false });

export const UserContextConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    memory: UserMemoryConfigSchema,
    understanding: UserUnderstandingConfigSchema,
    privacy: UserContextPrivacySchema,
    providerRouting: UserContextProviderRoutingSchema,
    dreaming: UserContextDreamingSchema,
  })
  .strict()
  .default({
    enabled: true,
    memory: { mode: 'confirmWrite', sources: ['session', 'curated'], writePolicy: { curated: 'confirm' } },
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
    dreaming: { enabled: false },
  });

export type UserContextConfig = z.infer<typeof UserContextConfigSchema>;
