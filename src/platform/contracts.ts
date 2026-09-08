import { z } from 'zod';

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const exactVersion = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

export const PlatformCapabilitySchema = z.enum([
  'models',
  'connectors',
  'tunnels',
  'shares',
  'managedRuntime',
  'runtimeFleet',
  'traceUpload',
  'a2a',
]);

export const PlatformDiscoverySchema = z.object({
  schemaVersion: z.literal('1'),
  platformId: identifier,
  displayName: z.string().min(1).max(120),
  deploymentMode: z.enum(['cloud', 'private', 'development']),
  region: identifier,
  endpoints: z.object({
    authorizationServer: z.string().url(),
    controlApi: z.string().url(),
    modelApi: z.string().url().optional(),
    storeApi: z.string().url().optional(),
    tunnelApi: z.string().url().optional(),
    shareApi: z.string().url().optional(),
    agentApi: z.string().url().optional(),
    a2aApi: z.string().url().optional(),
    realtime: z.string().url().optional(),
  }).strict(),
  capabilities: z.record(PlatformCapabilitySchema, z.boolean()),
  protocols: z.object({
    xopc: z.object({ min: z.string().min(1), max: z.string().min(1) }).strict(),
    mcp: z.array(z.string().min(1)).default([]),
    a2a: z.array(z.string().min(1)).default([]),
  }).strict(),
}).strict();

export type PlatformDiscovery = z.infer<typeof PlatformDiscoverySchema>;

export const PlatformConfigSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('standalone') }).strict(),
  z.object({
    mode: z.literal('connected'),
    url: z.string().url(),
    workspaceId: identifier.optional(),
    discovery: PlatformDiscoverySchema,
  }).strict(),
]).default({ mode: 'standalone' });

export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;

const agentDependency = z.object({
  id: identifier,
  version: exactVersion,
  sha256: sha256.optional(),
}).strict();

export const AgentManifestSchema = z.object({
  schemaVersion: z.literal('1'),
  agentId: identifier,
  version: exactVersion,
  runtime: z.object({
    engine: z.literal('xopc'),
    requires: z.string().min(1),
    execution: z.array(z.enum(['local', 'managed', 'enterprise'])).min(1),
  }).strict(),
  entry: z.object({
    instructions: z.string().min(1),
    workflow: z.string().min(1).optional(),
  }).strict(),
  models: z.object({
    intents: z.array(z.enum(['fast', 'reasoning', 'coding', 'review', 'vision', 'understanding'])),
    allow: z.array(z.string().min(1)),
  }).strict(),
  dependencies: z.object({
    skills: z.array(agentDependency),
    connectors: z.array(agentDependency),
    extensions: z.array(agentDependency).default([]),
  }).strict(),
  permissions: z.object({
    tools: z.array(z.string().min(1)),
    networkDomains: z.array(z.string().min(1)),
    filesystem: z.array(z.string().min(1)),
    effects: z.array(z.enum(['read', 'write', 'send', 'execute', 'delete', 'purchase', 'publish', 'admin'])),
  }).strict(),
  data: z.object({
    classification: z.enum(['public', 'internal', 'confidential', 'restricted']),
    memory: z.enum(['none', 'local', 'workspace']),
    retentionPolicy: identifier,
  }).strict(),
  quality: z.object({
    evaluationSuite: identifier.optional(),
    releaseGate: identifier.optional(),
  }).strict(),
}).strict();

export type AgentManifest = z.infer<typeof AgentManifestSchema>;

export const PlatformEventSchema = z.object({
  schemaVersion: z.literal('1'),
  eventId: identifier,
  type: z.string().min(1).max(160).regex(/^xopc\.[a-z0-9_.-]+$/),
  time: z.string().datetime(),
  organizationId: identifier,
  workspaceId: identifier,
  runId: identifier.optional(),
  traceId: identifier.optional(),
  sequence: z.number().int().nonnegative().optional(),
  producer: identifier,
  payload: z.record(z.string(), z.unknown()),
}).strict().superRefine((event, context) => {
  if (event.runId && event.sequence === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Run events require a sequence',
      path: ['sequence'],
    });
  }
});

export type PlatformEvent = z.infer<typeof PlatformEventSchema>;
