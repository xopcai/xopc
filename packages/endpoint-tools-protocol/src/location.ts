import { z } from 'zod';
import type { EndpointKind, EndpointToolDescriptor } from './index.js';

export const locationRequestSchema = z.object({ purpose: z.enum(['weather', 'nearby']),
  precision: z.enum(['approximate', 'precise']), category: z.enum(['restaurant', 'cafe', 'pharmacy', 'park']).optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.purpose === 'nearby') !== (value.category !== undefined)) ctx.addIssue({ code: 'custom', message: 'Category is required only for nearby queries' });
});
export type LocationRequest = z.infer<typeof locationRequestSchema>;
export const LOCATION_INPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['purpose', 'precision'],
  properties: { purpose: { enum: ['weather', 'nearby'] }, precision: { enum: ['approximate', 'precise'] },
    category: { enum: ['restaurant', 'cafe', 'pharmacy', 'park'] } },
  allOf: [{ if: { properties: { purpose: { const: 'nearby' } }, required: ['purpose'] },
    then: { properties: { category: {} }, required: ['category'] }, else: { not: { properties: { category: {} }, required: ['category'] } } }],
} as const;
export const locationSampleSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(100_000), capturedAt: z.number().int().nonnegative(),
  precision: z.enum(['approximate', 'precise']), coordinateSystem: z.literal('WGS84'),
}).strict();
export type LocationSample = z.infer<typeof locationSampleSchema>;
export const LOCATION_OUTPUT_SCHEMA = { type: 'array', minItems: 1, maxItems: 1,
  items: { type: 'object', additionalProperties: false, required: ['type', 'value'], properties: {
    type: { const: 'json' }, value: { type: 'object', additionalProperties: false,
      required: ['latitude', 'longitude', 'accuracyMeters', 'capturedAt', 'precision', 'coordinateSystem'],
      properties: { latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 },
        accuracyMeters: { type: 'number', minimum: 0, maximum: 100_000 }, capturedAt: { type: 'integer', minimum: 0 },
        precision: { enum: ['approximate', 'precise'] }, coordinateSystem: { const: 'WGS84' } } },
  } },
} as const;
export function locationDescriptor(kind: EndpointKind): EndpointToolDescriptor {
  return { name: `${kind}.device.get_location`, title: 'Use location once',
    description: 'With on-device consent, use one fresh WGS84 location for current weather (Open-Meteo) or nearby places (OpenStreetMap). Raw coordinates are consumed transiently by Gateway, never returned to the Agent or saved in history. Select approximate or precise; nearby requires a category. Each call requires new consent.',
    inputSchema: LOCATION_INPUT_SCHEMA, outputSchema: LOCATION_OUTPUT_SCHEMA,
    policyId: 'personal.foreground-read', sensitivity: 'personal', effect: 'read', confirmation: 'always',
    requiresForeground: true, requiredPermissions: ['location-read-once'], timeoutMs: 90_000, maxConcurrency: 1,
    supportsCancellation: true, idempotent: true, resultKinds: ['json'] };
}
