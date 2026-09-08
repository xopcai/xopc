import { z } from 'zod';

const ExpectationSchema = z.object({
  urlIncludes: z.string().optional(),
  titleIncludes: z.string().optional(),
  textIncludes: z.string().optional(),
  ref: z.string().optional(),
  state: z.enum(['visible', 'hidden']).optional(),
}).strict();

const TargetSchema = z.object({
  role: z.string().min(1),
  name: z.string().min(1).optional(),
  nameIncludes: z.string().min(1).optional(),
}).strict().superRefine((target, ctx) => {
  if (target.name && target.nameIncludes) ctx.addIssue({ code: 'custom', message: 'Use name or nameIncludes, not both.' });
});

const StepSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('navigate'), url: z.string().min(1), expect: ExpectationSchema.optional() }).strict(),
  z.object({ action: z.literal('click'), target: TargetSchema, expect: ExpectationSchema.optional() }).strict(),
  z.object({ action: z.literal('fill'), target: TargetSchema, value: z.string(), submit: z.boolean().optional(), expect: ExpectationSchema.optional() }).strict(),
  z.object({ action: z.literal('select'), target: TargetSchema, value: z.string(), expect: ExpectationSchema.optional() }).strict(),
  z.object({ action: z.literal('press'), target: TargetSchema.optional(), key: z.string().min(1), expect: ExpectationSchema.optional() }).strict(),
  z.object({ action: z.literal('scroll'), target: TargetSchema.optional(), deltaY: z.number(), expect: ExpectationSchema.optional() }).strict(),
  z.object({
    action: z.literal('wait'),
    condition: z.enum(['page_idle', 'text', 'visible', 'hidden']),
    value: z.string().optional(),
    target: TargetSchema.optional(),
    timeoutMs: z.number().int().min(100).max(120_000).optional(),
  }).strict(),
]);

const InputSchema = z.object({
  type: z.enum(['string', 'number', 'boolean']),
  required: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  description: z.string().min(1).max(200).optional(),
  choices: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1).max(50).optional(),
}).strict().superRefine((input, ctx) => {
  if (input.default !== undefined && typeof input.default !== input.type) {
    ctx.addIssue({ code: 'custom', message: `Default must be ${input.type}.` });
  }
  if (input.choices?.some((choice) => typeof choice !== input.type)) {
    ctx.addIssue({ code: 'custom', message: `Every choice must be ${input.type}.` });
  }
});

const DomainSchema = z.string().min(1).refine((value) => {
  if (value !== value.toLowerCase() || value.includes('/') || value.includes(':')) return false;
  try {
    return new URL(`https://${value}`).hostname === value;
  } catch {
    return false;
  }
}, 'Domain must be one exact lowercase hostname.');

export const BrowserAutomationDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  allowedDomains: z.array(DomainSchema).min(1),
  risk: z.enum(['read', 'draft', 'external_effect', 'destructive', 'sensitive']),
  inputs: z.record(z.string(), InputSchema).default({}),
  steps: z.array(StepSchema).min(1).max(100),
}).strict().superRefine((definition, ctx) => {
  if (new Set(definition.allowedDomains).size !== definition.allowedDomains.length) {
    ctx.addIssue({ code: 'custom', path: ['allowedDomains'], message: 'Domains must be unique.' });
  }
  for (const [index, step] of definition.steps.entries()) {
    const values = step.action === 'navigate' ? [step.url]
      : step.action === 'fill' || step.action === 'select' ? [step.value]
      : step.action === 'press' ? [step.key]
      : step.action === 'wait' && step.value ? [step.value]
      : [];
    for (const value of values) {
      for (const match of value.matchAll(/\$\{input\.([a-zA-Z][a-zA-Z0-9_]*)\}/g)) {
        if (!definition.inputs[match[1]!]) {
          ctx.addIssue({
            code: 'custom',
            path: ['steps', index],
            message: `Unknown input template: ${match[1]}.`,
          });
        }
      }
    }
  }
});
