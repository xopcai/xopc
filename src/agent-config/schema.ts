import { SpecialistProfileSchema } from '@xopcai/gateway-contract';
import { z } from 'zod';
import { voiceCallPreferencesSchema } from '@xopcai/realtime-protocol/voice';

export const DEFAULT_AGENT_MODEL_REF = 'xopc-cloud/auto';
export const DEFAULT_CORE_SKILLS = [
  'chat-charts',
  'configure-xopc',
  'define-task',
  'doc-coauthoring',
  'find-skills',
] as const;

export const DEFAULT_SKILL_POLICY = {
  mode: 'all-enabled' as const,
  exclude: [],
};

export const AgentIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);

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

export const ComputerModelRouteSchema = ModelRouteSchema.extend({
  fallbacks: z.array(ModelRefSchema).max(0, 'Computer Use does not support fallback models').default([]),
}).strict();

export const PhoneModelRouteSchema = ModelRouteSchema.extend({
  fallbacks: z.array(ModelRefSchema).max(0, 'Phone Use does not support fallback models').default([]),
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
  background: ModelRouteSchema.optional(),
  intents: ModelIntentRoutesSchema.default({}),
  imageUnderstanding: ModelRouteSchema.optional(),
  computerUse: ComputerModelRouteSchema.optional(),
  phoneUse: PhoneModelRouteSchema.optional(),
  imageGeneration: ImageGenerationRouteSchema.optional(),
}).strict();

export const AgentModelsOverrideSchema = z.object({
  chat: ModelRouteSchema.optional(),
  background: ModelRouteSchema.nullable().optional(),
  intents: ModelIntentOverridesSchema.optional(),
  imageUnderstanding: ModelRouteSchema.nullable().optional(),
  computerUse: ComputerModelRouteSchema.nullable().optional(),
  phoneUse: PhoneModelRouteSchema.nullable().optional(),
  imageGeneration: ImageGenerationRouteSchema.nullable().optional(),
}).strict();

export const ToolModeSchema = z.enum(['allow', 'ask', 'deny']);
export const ToolPolicySchema = z.object({
  mode: ToolModeSchema,
  /** Host assertion for external tools; remote annotations alone cannot grant read access. */
  readOnly: z.boolean().optional(),
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

export const RuntimePolicySchema = z.object({
  codemode: z.object({
    enabled: z.boolean().default(false),
    timeoutMs: z.number().int().min(1).max(60_000).default(60_000),
    maxConcurrentCalls: z.number().int().min(1).max(4).default(4),
    maxCalls: z.number().int().min(1).max(32).default(32),
    maxOutputTokens: z.number().int().min(1).max(4_000).default(4_000),
  }).strict().optional(),
  thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  commandIsolation: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('host') }).strict(),
    z.object({ mode: z.literal('docker'), image: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9./:_-]*@sha256:[a-f0-9]{64}$/), network: z.boolean().default(false), workspaceAccess: z.enum(['read-only', 'read-write']).default('read-only') }).strict(),
  ]).optional(),
  cloudCreditLimitPerRunMicro: z.string().regex(/^[1-9]\d{0,14}$/).optional(),
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
  skills: SkillDefaultsSchema.default(DEFAULT_SKILL_POLICY),
  tools: ToolPoliciesSchema.default({}),
  runtime: RuntimePolicySchema.default({}),
}).strict();

export const AgentProfileSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  creature: z.string().trim().optional(),
  style: z.string().trim().optional(),
  language: z.string().trim().optional(),
  emoji: z.string().trim().optional(),
  avatar: z.string().trim().optional(),
  voicePreference: z.object({
    provider: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(200),
    voice: z.string().trim().min(1).max(200),
  }).strict().optional(),
  voiceCallPreferences: voiceCallPreferencesSchema.optional(),
  messageReactionsEnabled: z.boolean().optional(),
  instructions: z.string().trim().min(1).optional(),
}).strict();

export const EXTERNAL_AGENT_KINDS = ['codex', 'agy', 'claude'] as const;
export type ExternalAgentKind = (typeof EXTERNAL_AGENT_KINDS)[number];

export const EXTERNAL_PERMISSION_MODES = ['full_access', 'auto_edit', 'ask'] as const;
export type ExternalPermissionMode = (typeof EXTERNAL_PERMISSION_MODES)[number];

export const EXTERNAL_CONTEXT_ACCESS_MODES = ['off', 'brief_only', 'read_only', 'read_write'] as const;
export type ExternalContextAccess = (typeof EXTERNAL_CONTEXT_ACCESS_MODES)[number];

export const AGY_AUTH_METHODS = ['oauth-personal', 'oauth-business', 'gemini-api-key', 'agent-platform'] as const;
export type AgyAuthMethod = (typeof AGY_AUTH_METHODS)[number];

export const CodexExecutionSchema = z.object({
  kind: z.literal('codex'),
  binaryPath: z.string().trim().min(1).max(500).optional(),
  homePath: z.string().trim().min(1).max(500).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  serviceTier: z.string().trim().min(1).max(64).optional(),
  permissionMode: z.enum(EXTERNAL_PERMISSION_MODES).optional(),
  contextAccess: z.enum(EXTERNAL_CONTEXT_ACCESS_MODES).optional(),
}).strict();
export type CodexExecution = z.infer<typeof CodexExecutionSchema>;

export const AgyExecutionSchema = z.object({
  kind: z.literal('agy'),
  binaryPath: z.string().trim().min(1).max(500).optional(),
  geminiDir: z.string().trim().min(1).max(500).optional(),
  authMethod: z.enum(AGY_AUTH_METHODS).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  permissionMode: z.enum(EXTERNAL_PERMISSION_MODES).optional(),
  contextAccess: z.enum(EXTERNAL_CONTEXT_ACCESS_MODES).optional(),
}).strict();
export type AgyExecution = z.infer<typeof AgyExecutionSchema>;

export const ClaudeExecutionSchema = z.object({
  kind: z.literal('claude'),
  binaryPath: z.string().trim().min(1).max(500).optional(),
  configDir: z.string().trim().min(1).max(500).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  permissionMode: z.enum(EXTERNAL_PERMISSION_MODES).optional(),
  contextAccess: z.enum(EXTERNAL_CONTEXT_ACCESS_MODES).optional(),
}).strict();
export type ClaudeExecution = z.infer<typeof ClaudeExecutionSchema>;

export const ExternalAgentExecutionSchema = z.discriminatedUnion('kind', [
  CodexExecutionSchema,
  AgyExecutionSchema,
  ClaudeExecutionSchema,
]);
export type ExternalAgentExecution = z.infer<typeof ExternalAgentExecutionSchema>;

export const AgentEntrySchema = z.object({
  id: AgentIdSchema,
  enabled: z.boolean().default(true),
  workspace: z.string().trim().min(1).optional(),
  profile: AgentProfileSchema.optional(),
  purpose: z.enum(['specialist', 'task_dispatcher']).optional(),
  execution: ExternalAgentExecutionSchema.optional(),
  specialistProfile: SpecialistProfileSchema.optional(),
  models: AgentModelsOverrideSchema.optional(),
  skills: SkillOverrideSchema.optional(),
  tools: ToolPoliciesSchema.optional(),
  toolAllowlist: z.array(z.string().min(1)).optional(),
  runtime: RuntimePolicySchema.optional(),
}).strict();

export const EffectiveAgentConfigSchema = z.object({
  id: AgentIdSchema,
  enabled: z.boolean(),
  workspace: z.string().min(1),
  profile: AgentProfileSchema.optional(),
  purpose: z.enum(['specialist', 'task_dispatcher']).optional(),
  specialistProfile: SpecialistProfileSchema.optional(),
  models: AgentModelsDefaultsSchema,
  skills: SkillDefaultsSchema,
  tools: ToolPoliciesSchema,
  toolAllowlist: z.array(z.string().min(1)).optional(),
  runtime: RuntimePolicySchema,
}).strict();

export type AgentModelsDefaults = z.infer<typeof AgentModelsDefaultsSchema>;
export type AgentModelsOverride = z.infer<typeof AgentModelsOverrideSchema>;
export type ModelIntent = z.infer<typeof ModelIntentSchema>;
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>;
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
export type AgentEntry = z.infer<typeof AgentEntrySchema>;
export type EffectiveAgentConfig = z.infer<typeof EffectiveAgentConfigSchema>;
export type SkillDefaults = z.infer<typeof SkillDefaultsSchema>;
export type SkillOverride = z.infer<typeof SkillOverrideSchema>;
