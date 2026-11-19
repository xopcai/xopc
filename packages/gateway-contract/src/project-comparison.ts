import { z } from 'zod';

export const PROJECT_COMPARISON_ACTION_PATH = '/api/project-comparison/action';
export const A2UI_VERSION = 'v0.9' as const;
export const PROJECT_COMPARISON_CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

const surfaceIdSchema = z.string().regex(/^comparison_[a-f0-9-]{36}$/);
export const projectComparisonIdsSchema = z.array(z.string().trim().min(1).max(512)).min(2).max(4)
  .refine(ids => new Set(ids).size === ids.length, 'Project IDs must be distinct');

const surfaceSchema = z.object({ surfaceId: surfaceIdSchema });
const version = z.literal(A2UI_VERSION);
const dataMessageSchema = z.object({
  version,
  updateDataModel: surfaceSchema.extend({ path: z.string(), value: z.json() }),
});

export const projectComparisonSchema = z.object({
  surfaceId: surfaceIdSchema,
  messages: z.tuple([
    z.object({ version, createSurface: surfaceSchema.extend({ catalogId: z.literal(PROJECT_COMPARISON_CATALOG) }) }),
    z.object({ version, updateComponents: surfaceSchema.extend({ components: z.array(z.record(z.string(), z.json())).max(40) }) }),
    dataMessageSchema,
  ]),
}).refine(({ surfaceId, messages: [create, components, data] }) => (
  [create.createSurface, components.updateComponents, data.updateDataModel].every(message => message.surfaceId === surfaceId)
));

export const projectComparisonActionSchema = z.object({
  version,
  action: z.object({
    name: z.literal('inspectProject'),
    surfaceId: surfaceIdSchema,
    sourceComponentId: z.string().regex(/^inspect_[0-3]$/),
    timestamp: z.iso.datetime({ offset: true }),
    context: z.object({ projectId: z.string().min(1).max(512) }),
  }),
});

export const projectComparisonActionResultSchema = z.object({
  messages: z.tuple([dataMessageSchema, dataMessageSchema]),
});

export type ProjectComparison = z.infer<typeof projectComparisonSchema>;
export type ProjectComparisonAction = z.infer<typeof projectComparisonActionSchema>;
export type ProjectComparisonActionResult = z.infer<typeof projectComparisonActionResultSchema>;
