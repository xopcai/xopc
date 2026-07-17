import { z } from 'zod';

const IdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);

export const DEFAULT_CAPABILITY_PRESET_ID = 'default';

export const ManifestModelRoleSchema = z
  .object({
    model: z.string().min(1),
    fallbacks: z.array(z.string().min(1)).optional(),
    description: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    const validateRef = (ref: string) => {
      const trimmed = ref.trim();
      const idx = trimmed.indexOf('/');
      return idx > 0 && idx < trimmed.length - 1;
    };
    if (!validateRef(entry.model)) {
      ctx.addIssue({
        code: 'custom',
        message: `model must be provider/model format (got '${entry.model}')`,
        path: ['model'],
      });
    }
    for (const [index, fallback] of (entry.fallbacks ?? []).entries()) {
      if (!validateRef(fallback)) {
        ctx.addIssue({
          code: 'custom',
          message: `fallback must be provider/model format (got '${fallback}')`,
          path: ['fallbacks', index],
        });
      }
    }
  });

export const AgentToolModelSchema = z
  .object({
    primary: z.string().min(1),
    fallbacks: z.array(z.string().min(1)).optional(),
    timeoutMs: z.number().int().positive().optional(),
    autoProviderFallback: z.boolean().optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    const validateRef = (ref: string) => {
      const trimmed = ref.trim();
      const idx = trimmed.indexOf('/');
      return idx > 0 && idx < trimmed.length - 1;
    };
    if (!validateRef(entry.primary)) {
      ctx.addIssue({
        code: 'custom',
        message: `primary must be provider/model format (got '${entry.primary}')`,
        path: ['primary'],
      });
    }
    for (const [index, fallback] of (entry.fallbacks ?? []).entries()) {
      if (!validateRef(fallback)) {
        ctx.addIssue({
          code: 'custom',
          message: `fallback must be provider/model format (got '${fallback}')`,
          path: ['fallbacks', index],
        });
      }
    }
  });

export const ModelPolicySchema = z
  .object({
    defaultRole: IdSchema,
    roles: z.record(IdSchema, ManifestModelRoleSchema).default({}),
    imageModel: AgentToolModelSchema.optional(),
    imageGenerationModel: AgentToolModelSchema.optional(),
    policy: z
      .object({
        allowFallbacks: z.boolean().optional(),
        maxCostTier: z.enum(['low', 'medium', 'high']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ModelPolicyPatchSchema = z
  .object({
    defaultRole: IdSchema.optional(),
    roles: z.record(IdSchema, ManifestModelRoleSchema).optional(),
    imageModel: AgentToolModelSchema.optional(),
    imageGenerationModel: AgentToolModelSchema.optional(),
    policy: z
      .object({
        allowFallbacks: z.boolean().optional(),
        maxCostTier: z.enum(['low', 'medium', 'high']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ToolModeSchema = z.enum(['allow', 'confirm', 'deny']);
export const ToolScopeSchema = z.enum(['readonly', 'workspace', 'unrestricted']);

export const ToolPolicySchema = z
  .object({
    mode: ToolModeSchema,
    scope: ToolScopeSchema.optional(),
    limits: z
      .object({
        maxCallsPerTurn: z.number().int().positive().optional(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ToolPolicySetSchema = z
  .object({
    builtin: z.record(z.string().min(1), ToolPolicySchema).default({}),
    mcp: z
      .object({
        servers: z.record(z.string().min(1), ToolPolicySchema).optional(),
        tools: z.record(z.string().min(1), ToolPolicySchema).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .default({ builtin: {} });

export const SkillPolicySchema = z
  .object({
    mode: z.enum(['all', 'allowlist', 'denylist', 'off']).default('all'),
    allow: z.array(z.string().min(1)).optional(),
    deny: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .default({ mode: 'all' });

export const DreamingPhasePolicySchema = z
  .object({
    enabled: z.boolean().optional(),
    cron: z.string().min(1).optional(),
  })
  .strict();

export const DreamingLightPolicySchema = DreamingPhasePolicySchema.extend({
  lookbackDays: z.number().int().positive().optional(),
  limit: z.number().int().nonnegative().optional(),
  dedupeSimilarity: z.number().min(0).max(1).optional(),
}).strict();

export const DreamingDeepPolicySchema = DreamingPhasePolicySchema.extend({
  minScore: z.number().min(0).max(1).optional(),
  minRecallCount: z.number().int().positive().optional(),
  minUniqueQueries: z.number().int().positive().optional(),
  limit: z.number().int().nonnegative().optional(),
  recencyHalfLifeDays: z.number().positive().optional(),
  maxAgeDays: z.number().positive().optional(),
}).strict();

export const DreamingRemPolicySchema = DreamingPhasePolicySchema.extend({
  lookbackDays: z.number().int().positive().optional(),
  limit: z.number().int().nonnegative().optional(),
  minPatternStrength: z.number().min(0).max(1).optional(),
}).strict();

export const DreamingPolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    frequency: z.string().min(1).optional(),
    timezone: z.string().optional(),
    phases: z
      .object({
        light: DreamingLightPolicySchema.optional(),
        deep: DreamingDeepPolicySchema.optional(),
        rem: DreamingRemPolicySchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();

export const UserUnderstandingPolicySchema = z
  .object({
    enabled: z.boolean().optional(),
    adaptiveCadence: z.boolean().optional(),
    reviewIntervalTurns: z.number().int().min(1).max(1_000).optional(),
    maxHistoryMessages: z.number().int().min(1).max(200).optional(),
    maxDurationMs: z.number().int().min(1_000).max(600_000).optional(),
  })
  .strict();

export const MemoryPolicySchema = z
  .object({
    mode: z.enum(['off', 'readOnly', 'confirmWrite', 'auto']).default('off'),
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
    privacy: z
      .object({
        crossAgentSharing: z.enum(['deny', 'readOnly', 'allow']).default('deny'),
        sensitiveWritePolicy: z.enum(['deny', 'confirm', 'allow']).default('confirm'),
      })
      .strict()
      .optional(),
    providerRouting: z
      .object({
        searchStrategy: z
          .enum(['local-first', 'external-first', 'fanout', 'local-only', 'external-only'])
          .default('fanout'),
        writeStrategy: z
          .enum(['local-first', 'external-first', 'write-through', 'local-only', 'external-only'])
          .default('local-first'),
        allowExternalWrites: z.boolean().default(false),
        allowedProviderIds: z.array(z.string().min(1)).optional(),
        autoWriteKinds: z
          .array(
            z.enum([
              'user_profile',
              'preference',
              'boundary',
              'relationship',
              'project_context',
              'commitment',
              'routine',
              'personal_logistics',
              'open_question',
              'milestone',
              'current_state',
              'agent_note',
              'workspace_fact',
              'daily_note',
              'session_summary',
              'derived_insight',
              'task_lesson',
              'tool_preference',
              'long_term_goal',
            ]),
          )
          .optional(),
      })
      .strict()
      .optional(),
    dreaming: DreamingPolicySchema,
    understanding: UserUnderstandingPolicySchema.optional(),
  })
  .strict()
  .default({ mode: 'off', sources: ['session'] });

export const WorkflowPolicySchema = z
  .object({
    default: z.string().min(1).optional(),
    allowed: z.array(z.string().min(1)).optional(),
    suggested: z
      .array(
        z
          .object({
            intent: z.string().min(1),
            workflow: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
  .default({});

export const BoundaryPolicySchema = z
  .object({
    requiresConfirmation: z.array(z.string().min(1)).default([]),
    forbidden: z.array(z.string().min(1)).default([]),
    escalation: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .default({ requiresConfirmation: [], forbidden: [], escalation: [] });

export const WorkspacePolicySchema = z
  .object({
    root: z.string().min(1),
  })
  .strict();

export const RuntimePolicySchema = z
  .object({
    maxTurns: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    maxToolFailuresPerTurn: z.number().int().positive().optional(),
  })
  .strict()
  .optional();

export const PromptPolicySchema = z
  .object({
    customInstructions: z.string().optional(),
  })
  .strict()
  .optional();

export const AgentIdentitySchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    role: z.string().min(1),
    language: z.string().min(1).default('en'),
    tone: z.string().min(1).default('direct'),
    avatar: z.string().optional(),
  })
  .strict();

export const AgentResponsibilitiesSchema = z
  .object({
    primary: z.array(z.string().min(1)).min(1),
    secondary: z.array(z.string().min(1)).optional(),
    outOfScope: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const AgentManifestSchema = z
  .object({
    id: IdSchema,
    enabled: z.boolean().default(true),
    extends: z.array(IdSchema).optional(),
    identity: AgentIdentitySchema,
    responsibilities: AgentResponsibilitiesSchema,
    workspace: WorkspacePolicySchema,
    models: ModelPolicySchema,
    tools: ToolPolicySetSchema,
    skills: SkillPolicySchema,
    memory: MemoryPolicySchema,
    workflows: WorkflowPolicySchema,
    boundaries: BoundaryPolicySchema,
    runtime: RuntimePolicySchema,
    prompt: PromptPolicySchema,
  })
  .strict();

export const AgentConfigEntrySchema = AgentManifestSchema.extend({
  models: ModelPolicySchema.optional(),
}).strict();

export const CapabilityPresetSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1),
    description: z.string().optional(),
    version: z.number().int().positive().default(1),
    extends: z.array(IdSchema).optional(),
    models: ModelPolicyPatchSchema.optional(),
    tools: ToolPolicySetSchema.optional(),
    skills: SkillPolicySchema.optional(),
    memory: MemoryPolicySchema.optional(),
    workflows: WorkflowPolicySchema.optional(),
    boundaries: BoundaryPolicySchema.optional(),
    runtime: RuntimePolicySchema,
    locks: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type AgentManifest = z.infer<typeof AgentManifestSchema>;
export type AgentConfigEntry = z.infer<typeof AgentConfigEntrySchema>;
export type CapabilityPreset = z.infer<typeof CapabilityPresetSchema>;
export type EffectiveAgentManifest = AgentManifest;
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;
