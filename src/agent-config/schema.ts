import { z } from 'zod';

export const DEFAULT_AGENT_MODEL_REF = 'deepseek/deepseek-v4-flash';

const AgentIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);

export const ModelRefSchema = z.string().trim().min(1).refine((value) => {
  const separator = value.indexOf('/');
  return separator > 0 && separator < value.length - 1;
}, 'model must use provider/model format');

export const ModelRouteSchema = z.object({
  primary: ModelRefSchema,
  fallbacks: z.array(ModelRefSchema).default([]),
}).strict();

export const ImageGenerationRouteSchema = ModelRouteSchema.extend({
  timeoutMs: z.number().int().positive().optional(),
  autoProviderFallback: z.boolean().default(false),
}).strict();

export const ModelIntentSchema = z.enum([
  'fast',
  'reasoning',
  'coding',
  'review',
  'vision',
  'understanding',
]);

const ModelIntentRoutesSchema = z.partialRecord(ModelIntentSchema, ModelRouteSchema);
const ModelIntentOverridesSchema = z.partialRecord(ModelIntentSchema, ModelRouteSchema.nullable());

export const AgentModelsDefaultsSchema = z.object({
  chat: ModelRouteSchema,
  intents: ModelIntentRoutesSchema.default({}),
  imageUnderstanding: ModelRouteSchema.optional(),
  imageGeneration: ImageGenerationRouteSchema.optional(),
}).strict();

export const AgentModelsOverrideSchema = z.object({
  chat: ModelRouteSchema.optional(),
  intents: ModelIntentOverridesSchema.optional(),
  imageUnderstanding: ModelRouteSchema.nullable().optional(),
  imageGeneration: ImageGenerationRouteSchema.nullable().optional(),
}).strict();

export const ToolModeSchema = z.enum(['allow', 'ask', 'deny']);
export const ToolPolicySchema = z.object({
  mode: ToolModeSchema,
  maxCallsPerTurn: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
}).strict();

export const ToolPoliciesSchema = z.record(z.string().min(1), ToolPolicySchema);

export const SkillDefaultsSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('all-enabled'),
    exclude: z.array(z.string().min(1)).default([]),
  }).strict(),
  z.object({
    mode: z.literal('selected'),
    include: z.array(z.string().min(1)).default([]),
  }).strict(),
]);

export const SkillOverrideSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('merge'),
    add: z.array(z.string().min(1)).default([]),
    remove: z.array(z.string().min(1)).default([]),
  }).strict().superRefine((value, context) => {
    const additions = new Set(value.add);
    for (const skill of value.remove) {
      if (additions.has(skill)) {
        context.addIssue({
          code: 'custom',
          path: ['remove'],
          message: `skill "${skill}" cannot be both added and removed`,
        });
      }
    }
  }),
  z.object({
    mode: z.literal('replace'),
    include: z.array(z.string().min(1)).default([]),
  }).strict(),
]);

export const WorkflowPolicySchema = z.object({
  default: z.string().min(1).optional(),
  allowed: z.array(z.string().min(1)).optional(),
}).strict();

export const RuntimePolicySchema = z.object({
  maxTurns: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxToolFailuresPerTurn: z.number().int().positive().optional(),
  promptCache: z.object({
    mode: z.enum(['off', 'auto']).default('auto'),
    lifetime: z.enum(['short', 'long']).default('short'),
  }).strict().optional(),
}).strict();

export const AgentDefaultsSchema = z.object({
  models: AgentModelsDefaultsSchema,
  skills: SkillDefaultsSchema.default({ mode: 'all-enabled', exclude: [] }),
  tools: ToolPoliciesSchema.default({}),
  workflows: WorkflowPolicySchema.default({}),
  runtime: RuntimePolicySchema.default({}),
}).strict();

export const AgentProfileSchema = z.object({
  name: z.string().trim().min(1),
  instructions: z.string().trim().min(1).optional(),
}).strict();

export const AgentEntrySchema = z.object({
  id: AgentIdSchema,
  enabled: z.boolean().default(true),
  workspace: z.string().trim().min(1).optional(),
  profile: AgentProfileSchema.optional(),
  models: AgentModelsOverrideSchema.optional(),
  skills: SkillOverrideSchema.optional(),
  tools: ToolPoliciesSchema.optional(),
  workflows: WorkflowPolicySchema.optional(),
  runtime: RuntimePolicySchema.optional(),
}).strict();

export const AgentsConfigSchema = z.object({
  default: AgentIdSchema.default('main'),
  defaults: AgentDefaultsSchema.default({
    models: {
      chat: { primary: DEFAULT_AGENT_MODEL_REF, fallbacks: [] },
      intents: {},
    },
    skills: { mode: 'all-enabled', exclude: [] },
    tools: {},
    workflows: {},
    runtime: {},
  }),
  list: z.array(AgentEntrySchema).default([{ id: 'main', enabled: true }]),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  value.list.forEach((agent, index) => {
    if (seen.has(agent.id)) {
      context.addIssue({
        code: 'custom',
        path: ['list', index, 'id'],
        message: `duplicate agent id "${agent.id}"`,
      });
    }
    seen.add(agent.id);
  });
  if (!value.list.some((agent) => agent.id === value.default && agent.enabled)) {
    context.addIssue({
      code: 'custom',
      path: ['default'],
      message: `default agent "${value.default}" must reference an enabled entry`,
    });
  }
});

export const EffectiveAgentConfigSchema = z.object({
  id: AgentIdSchema,
  enabled: z.boolean(),
  workspace: z.string().min(1),
  profile: z.object({
    name: z.string().min(1),
    instructions: z.string().optional(),
  }).strict().optional(),
  models: AgentModelsDefaultsSchema,
  skills: SkillDefaultsSchema,
  tools: ToolPoliciesSchema,
  workflows: WorkflowPolicySchema,
  runtime: RuntimePolicySchema,
}).strict();

export type AgentModelsDefaults = z.infer<typeof AgentModelsDefaultsSchema>;
export type AgentModelsOverride = z.infer<typeof AgentModelsOverrideSchema>;
export type ModelIntent = z.infer<typeof ModelIntentSchema>;
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>;
export type AgentEntry = z.infer<typeof AgentEntrySchema>;
export type AgentsConfig = z.infer<typeof AgentsConfigSchema>;
export type EffectiveAgentConfig = z.infer<typeof EffectiveAgentConfigSchema>;
export type SkillDefaults = z.infer<typeof SkillDefaultsSchema>;
export type SkillOverride = z.infer<typeof SkillOverrideSchema>;
