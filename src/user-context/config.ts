import { z } from 'zod';

import { ResponseLanguageSchema } from '../i18n/response-language.js';

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
  gapAudit: true,
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
    gapAudit: z.boolean().default(true),
    model: z.string().min(1).optional(),
    minToolResultKeepChars: z.number().int().min(200).default(1_000),
    maxActiveTranscriptBytes: z.number().int().min(64_000).default(2_000_000),
    postCompactionSections: z.array(z.string().min(1)).max(12).default(['Session Startup', 'Red Lines']),
  })
  .strict()
  .default(DEFAULT_CONTEXT_COMPACTION_POLICY);

const WritePolicySchema = z.enum(['deny', 'confirm', 'allow']);
const MaintenanceTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected time in HH:mm format');

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const UserModelConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    writePolicy: WritePolicySchema.default('confirm'),
    sensitiveWritePolicy: WritePolicySchema.default('confirm'),
    processingPolicy: z.enum(['local_only', 'remote_allowed']).default('remote_allowed'),
    extraction: z.object({
      reviewIntervalTurns: z.number().int().min(1).max(1_000).default(10),
      maxHistoryMessages: z.number().int().min(1).max(200).default(80),
      maxDurationMs: z.number().int().min(1_000).max(600_000).default(120_000),
    }).strict().default({
      reviewIntervalTurns: 10,
      maxHistoryMessages: 80,
      maxDurationMs: 120_000,
    }),
    maintenance: z.object({
      enabled: z.boolean().default(true),
      timezone: z.string().min(1).refine(isValidTimeZone, 'Invalid IANA timezone').optional(),
      temporalSweepMinutes: z.number().int().min(15).max(60)
        .refine((value) => 60 % value === 0, 'Must divide one hour evenly').default(60),
      dailyTime: MaintenanceTimeSchema.default('03:00'),
      weeklyDay: z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']).default('sun'),
      weeklyTime: MaintenanceTimeSchema.default('04:00'),
      evidenceThreshold: z.number().int().min(2).max(10).default(2),
      limit: z.number().int().positive().max(10_000).default(1_000),
      staleRetentionDays: z.number().int().min(1).max(3_650).default(30),
    }).strict().default({
      enabled: true,
      temporalSweepMinutes: 60,
      dailyTime: '03:00',
      weeklyDay: 'sun',
      weeklyTime: '04:00',
      evidenceThreshold: 2,
      limit: 1_000,
      staleRetentionDays: 30,
    }),
  })
  .strict()
  .default({
    enabled: true,
    writePolicy: 'confirm',
    sensitiveWritePolicy: 'confirm',
    processingPolicy: 'remote_allowed',
    extraction: {
      reviewIntervalTurns: 10,
      maxHistoryMessages: 80,
      maxDurationMs: 120_000,
    },
    maintenance: {
      enabled: true,
      temporalSweepMinutes: 60,
      dailyTime: '03:00',
      weeklyDay: 'sun',
      weeklyTime: '04:00',
      evidenceThreshold: 2,
      limit: 1_000,
      staleRetentionDays: 30,
    },
  });

export const KnowledgeMemoryConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    writePolicy: WritePolicySchema.default('confirm'),
    sources: z.array(z.enum(['session', 'workspace', 'project', 'connector'])).default(['session', 'workspace']),
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
    enabled: true,
    writePolicy: 'confirm',
    sources: ['session', 'workspace'],
    searchStrategy: 'fanout',
    writeStrategy: 'local-first',
    allowExternalWrites: false,
  });

export const ContextPlanningConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    maxAssertions: z.number().int().min(1).max(100).default(20),
    maxKnowledge: z.number().int().min(0).max(100).default(12),
    maxChars: z.number().int().min(500).max(50_000).default(6_000),
    compaction: ContextCompactionPolicySchema,
  })
  .strict()
  .default({
    enabled: true,
    maxAssertions: 20,
    maxKnowledge: 12,
    maxChars: 6_000,
    compaction: DEFAULT_CONTEXT_COMPACTION_POLICY,
  });

export const UserContextConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    preferences: z
      .object({
        responseLanguage: ResponseLanguageSchema.default('auto'),
      })
      .strict()
      .default({ responseLanguage: 'auto' }),
    userModel: UserModelConfigSchema,
    knowledgeMemory: KnowledgeMemoryConfigSchema,
    contextPlanning: ContextPlanningConfigSchema,
  })
  .strict()
  .default({
    enabled: true,
    preferences: { responseLanguage: 'auto' },
    userModel: UserModelConfigSchema.parse({}),
    knowledgeMemory: KnowledgeMemoryConfigSchema.parse({}),
    contextPlanning: ContextPlanningConfigSchema.parse({}),
  });

export type UserContextConfig = z.infer<typeof UserContextConfigSchema>;
export type UserModelConfig = z.infer<typeof UserModelConfigSchema>;
export type KnowledgeMemoryConfig = z.infer<typeof KnowledgeMemoryConfigSchema>;
export type ContextPlanningConfig = z.infer<typeof ContextPlanningConfigSchema>;
