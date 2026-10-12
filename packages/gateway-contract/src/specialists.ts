import { z } from 'zod';

export const SPECIALIST_VOCABULARY = {
  domains: ['general', 'coordination', 'software', 'writing', 'research', 'data', 'design', 'operations'],
  taskTypes: ['general_assistance', 'task_planning', 'bug_fix', 'implementation', 'code_review', 'writing', 'editing', 'research', 'news_research', 'data_analysis', 'data_cleaning', 'image_generation', 'automation'],
  inputKinds: ['text', 'repository', 'csv', 'spreadsheet', 'web_page', 'image'],
  outputKinds: ['answer', 'plan', 'code_patch', 'document', 'report', 'chart', 'script', 'image', 'design_brief'],
} as const;

const identifiers = z.array(z.string().trim().min(1).max(80).toLowerCase()).max(16);

export const SpecialistProfileSchema = z.object({
  version: z.literal(1),
  domains: identifiers,
  taskTypes: identifiers,
  inputKinds: identifiers,
  outputKinds: identifiers,
  specialties: z.array(z.string().trim().min(1).max(120)).max(8),
  examples: z.array(z.object({
    request: z.string().trim().min(1).max(200),
    deliverable: z.string().trim().min(1).max(200),
  }).strict()).max(4),
  limitations: z.array(z.string().trim().min(1).max(120)).max(8),
}).strict();

export const SpecialistTaskRequirementsSchema = z.object({
  version: z.literal(1).default(1),
  summary: z.string().trim().min(1).max(300),
  domain: z.string().trim().min(1).max(80).toLowerCase().optional(),
  taskType: z.string().trim().min(1).max(80).toLowerCase().optional(),
  inputKinds: identifiers.optional(),
  outputKinds: identifiers.optional(),
  requiredTools: identifiers.optional(),
  requiredSkills: identifiers.optional(),
  requestedAgentId: z.string().trim().min(1).max(100).optional(),
  connector: z.object({
    connectorId: z.string().trim().min(1).max(200),
    accountId: z.string().trim().min(1).max(200).optional(),
  }).strict().optional(),
}).strict();

export type SpecialistProfile = z.infer<typeof SpecialistProfileSchema>;
export type SpecialistTaskRequirements = z.infer<typeof SpecialistTaskRequirementsSchema>;

export function normalizeSpecialistRequirements(input: unknown): SpecialistTaskRequirements {
  const parsed = SpecialistTaskRequirementsSchema.parse(input);
  for (const field of ['inputKinds', 'outputKinds', 'requiredTools', 'requiredSkills'] as const) {
    if (parsed[field]) parsed[field] = [...new Set(parsed[field])].sort();
  }
  return parsed;
}
