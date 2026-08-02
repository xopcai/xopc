import yaml from 'js-yaml';
import { z } from 'zod';

export const BROWSER_RECIPE_API_VERSION = 'xopc.ai/browser-recipe/v1' as const;

const IdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]));

const PipelineArgSchema = z.object({
  type: z.enum(['string', 'number', 'integer', 'boolean']),
  required: z.boolean().optional(),
  default: JsonValueSchema.optional(),
  description: z.string().max(500).optional(),
  choices: z.array(JsonValueSchema).optional(),
}).strict().superRefine((definition, ctx) => {
  const matchesType = (value: unknown) => {
    if (definition.type === 'string') return typeof value === 'string';
    if (definition.type === 'boolean') return typeof value === 'boolean';
    if (definition.type === 'integer') return typeof value === 'number' && Number.isInteger(value);
    return typeof value === 'number' && Number.isFinite(value);
  };
  if (definition.default !== undefined && !matchesType(definition.default)) {
    ctx.addIssue({ code: 'custom', path: ['default'], message: `Default must match arg type ${definition.type}.` });
  }
  definition.choices?.forEach((choice, index) => {
    if (!matchesType(choice)) ctx.addIssue({ code: 'custom', path: ['choices', index], message: `Choice must match arg type ${definition.type}.` });
  });
});

const DomainSchema = z.string().trim().toLowerCase().regex(
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/,
  'Domain must be a hostname without scheme, path, port, or wildcard.',
);

const StepSchema: z.ZodType<Record<string, Record<string, unknown>>> = z.record(
  z.string(),
  z.record(z.string(), z.unknown()),
).superRefine((step, ctx) => {
  if (Object.keys(step).length !== 1) {
    ctx.addIssue({ code: 'custom', message: 'Each step must contain exactly one action.' });
  }
});

const RecipeSchema = z.object({
  apiVersion: z.literal(BROWSER_RECIPE_API_VERSION),
  id: IdSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  risk: z.enum(['read_only', 'account_write', 'sensitive']),
  domains: z.array(DomainSchema).min(1),
  timeoutSeconds: z.number().int().min(1).max(3600).optional(),
  args: z.record(z.string(), PipelineArgSchema).default({}),
  pipeline: z.array(StepSchema).min(1),
  on_error: z.array(StepSchema).optional(),
}).strict();

export type PipelineArgDef = z.infer<typeof PipelineArgSchema>;
export interface PipelineStep {
  action: string;
  args: Record<string, unknown>;
}
export interface PipelineDocument {
  apiVersion: typeof BROWSER_RECIPE_API_VERSION;
  id: string;
  name: string;
  description?: string;
  risk: 'read_only' | 'account_write' | 'sensitive';
  domains: string[];
  timeoutSeconds?: number;
  args: Record<string, PipelineArgDef>;
  pipeline: PipelineStep[];
  onError?: PipelineStep[];
}
export interface PipelineValidationError { path: string; message: string }
export interface PipelineParseResult {
  ok: boolean;
  document?: PipelineDocument;
  errors: PipelineValidationError[];
}

function stepsFromRaw(steps: Array<Record<string, Record<string, unknown>>>): PipelineStep[] {
  return steps.map((step) => {
    const [action, args] = Object.entries(step)[0]!;
    return { action, args };
  });
}

export function parseBrowserPipeline(yamlSource: string): PipelineParseResult {
  let raw: unknown;
  try {
    raw = yaml.load(yamlSource);
  } catch (error) {
    return { ok: false, errors: [{ path: '', message: `YAML parse error: ${error instanceof Error ? error.message : String(error)}` }] };
  }

  const parsed = RecipeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  return {
    ok: true,
    document: {
      apiVersion: parsed.data.apiVersion,
      id: parsed.data.id,
      name: parsed.data.name,
      description: parsed.data.description,
      risk: parsed.data.risk,
      domains: parsed.data.domains,
      timeoutSeconds: parsed.data.timeoutSeconds,
      args: parsed.data.args,
      pipeline: stepsFromRaw(parsed.data.pipeline),
      onError: parsed.data.on_error ? stepsFromRaw(parsed.data.on_error) : undefined,
    },
    errors: [],
  };
}
