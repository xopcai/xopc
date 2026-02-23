import { z } from 'zod';

// ============================================
// Model API Schema
// ============================================

export const ModelApiSchema = z.union([
  z.literal("openai-completions"),
  z.literal("openai-responses"),
  z.literal("anthropic-messages"),
  z.literal("google-generative-ai"),
  z.literal("github-copilot"),
  z.literal("bedrock-converse-stream"),
  z.literal("ollama"),
]);

export type ModelApi = z.infer<typeof ModelApiSchema>;

// ============================================
// Model Compatibility Schema
// ============================================

export const ModelCompatSchema = z
  .object({
    supportsStore: z.boolean().optional(),
    supportsDeveloperRole: z.boolean().optional(),
    supportsReasoningEffort: z.boolean().optional(),
    supportsUsageInStreaming: z.boolean().optional(),
    supportsStrictMode: z.boolean().optional(),
    maxTokensField: z
      .union([z.literal("max_completion_tokens"), z.literal("max_tokens")])
      .optional(),
    thinkingFormat: z.union([z.literal("openai"), z.literal("zai"), z.literal("qwen")]).optional(),
    requiresToolResultName: z.boolean().optional(),
    requiresAssistantAfterToolResult: z.boolean().optional(),
    requiresThinkingAsText: z.boolean().optional(),
    requiresMistralToolIds: z.boolean().optional(),
  })
  .strict()
  .optional();

export type ModelCompatConfig = z.infer<typeof ModelCompatSchema>;

// ============================================
// Model Definition Schema
// ============================================

export const ModelCostSchema = z
  .object({
    input: z.number().optional(),
    output: z.number().optional(),
    cacheRead: z.number().optional(),
    cacheWrite: z.number().optional(),
  })
  .strict()
  .optional();

export const ModelDefinitionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    api: ModelApiSchema.optional(),
    reasoning: z.boolean().optional(),
    input: z.array(z.union([z.literal("text"), z.literal("image")])).optional(),
    cost: ModelCostSchema,
    contextWindow: z.number().positive().optional(),
    maxTokens: z.number().positive().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    compat: ModelCompatSchema,
  })
  .strict();

export type ModelDefinitionConfig = z.infer<typeof ModelDefinitionSchema>;

// ============================================
// Model Provider Schema
// ============================================

export const ModelProviderAuthSchema = z
  .union([
    z.literal("api-key"),
    z.literal("aws-sdk"),
    z.literal("oauth"),
    z.literal("token"),
  ])
  .optional();

export const ModelProviderSchema = z
  .object({
    baseUrl: z.string().min(1),
    apiKey: z.string().optional(),
    auth: ModelProviderAuthSchema,
    api: ModelApiSchema.optional(),
    headers: z.record(z.string(), z.string()).optional(),
    authHeader: z.boolean().optional(),
    models: z.array(ModelDefinitionSchema),
  })
  .strict();

export type ModelProviderConfig = z.infer<typeof ModelProviderSchema>;

// ============================================
// Bedrock Discovery Schema
// ============================================

export const BedrockDiscoverySchema = z
  .object({
    enabled: z.boolean().optional(),
    region: z.string().optional(),
    providerFilter: z.array(z.string()).optional(),
    refreshInterval: z.number().int().nonnegative().optional(),
    defaultContextWindow: z.number().int().positive().optional(),
    defaultMaxTokens: z.number().int().positive().optional(),
  })
  .strict()
  .optional();

// ============================================
// Models Config Schema
// ============================================

export const ModelsConfigSchema = z
  .object({
    mode: z.union([z.literal("merge"), z.literal("replace")]).optional(),
    providers: z.record(z.string(), ModelProviderSchema).optional(),
    bedrockDiscovery: BedrockDiscoverySchema,
  })
  .strict()
  .optional();

export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;
