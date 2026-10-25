import { z } from 'zod';

const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timezone = z.string().min(1).max(80).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
});
const locale = z.string().min(1).max(80).refine(value => {
  try { return Intl.getCanonicalLocales(value).length === 1; } catch { return false; }
});
export const ENDPOINT_CONTEXT_HEARTBEAT_MS = 15_000;
export const ENDPOINT_CONTEXT_OFFLINE_MS = 45_000;
export const ENDPOINT_CONTEXT_REFRESH_MS = 60_000;
export const endpointContextValuesSchema = z.strictObject({
  'environment.timezone': timezone.optional(),
  'environment.locale': locale.optional(),
  'device.power': z.strictObject({ batteryPercent: z.number().min(0).max(100).nullable(), charging: z.boolean().nullable() }).optional(),
});
export type EndpointContextValues = z.infer<typeof endpointContextValuesSchema>;
export const endpointContextReportSchema = z.strictObject({
  version: z.literal(1), reportId: z.string().min(1).max(128), connectionEpoch: z.string().min(1).max(128),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  baseRevision: z.number().int().nonnegative().nullable(), mode: z.enum(['full', 'patch']),
  capturedAt: timestamp, values: endpointContextValuesSchema,
  cleared: z.array(z.enum(['environment.timezone', 'environment.locale', 'device.power'])).max(3).default([]),
}).superRefine((value, ctx) => {
  if ((value.mode === 'full') !== (value.baseRevision === null)) ctx.addIssue({ code: 'custom', message: 'Invalid report baseline' });
  if (value.cleared.some(key => value.values[key] !== undefined)) ctx.addIssue({ code: 'custom', message: 'Cannot set and clear the same field' });
});
export type EndpointContextReport = z.infer<typeof endpointContextReportSchema>;
export const endpointContextHeartbeatSchema = z.strictObject({
  connectionEpoch: z.string().min(1).max(128), sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  availability: z.enum(['foreground', 'background']),
});
export type EndpointContextHeartbeat = z.infer<typeof endpointContextHeartbeatSchema>;
export type EndpointContextField = keyof EndpointContextValues;
export interface EndpointContextView {
  version: 1;
  endpointId: string;
  revision: number;
  availability: 'foreground' | 'background' | 'offline';
  sourceValidUntil?: number;
  fields: Partial<Record<EndpointContextField, {
    status: 'fresh' | 'stale' | 'unavailable'; capturedAt: number; validUntil: number;
    value?: EndpointContextValues[EndpointContextField];
  }>>;
}

/** Re-evaluate frozen data at use time, with the same field allowlist as ingestion. */
export function projectEndpointContextView(input: unknown, endpointId: string, now = Date.now()): EndpointContextView | undefined {
  const parsed = z.strictObject({ version: z.literal(1), endpointId: z.literal(endpointId),
    revision: z.number().int().nonnegative(), availability: z.enum(['foreground', 'background', 'offline']), sourceValidUntil: timestamp.optional(),
    fields: z.record(z.string(), z.strictObject({ status: z.enum(['fresh', 'stale', 'unavailable']),
      capturedAt: timestamp, validUntil: timestamp, value: z.unknown().optional() })).refine(fields => Object.keys(fields).length <= 3),
  }).safeParse(input);
  if (!parsed.success) return undefined;
  const availability = parsed.data.sourceValidUntil !== undefined && parsed.data.sourceValidUntil <= now ? 'offline' : parsed.data.availability;
  const view: EndpointContextView = { version: 1, endpointId, revision: parsed.data.revision, availability,
    ...(parsed.data.sourceValidUntil === undefined ? {} : { sourceValidUntil: parsed.data.sourceValidUntil }), fields: {} };
  for (const [key, reading] of Object.entries(parsed.data.fields)) {
    if (!['environment.timezone', 'environment.locale', 'device.power'].includes(key)) continue;
    const maxAge = key === 'device.power' ? 30_000 : 300_000;
    const validUntil = Math.min(reading.validUntil, reading.capturedAt + maxAge);
    const usable = availability === 'foreground' && reading.status === 'fresh'
      && reading.capturedAt <= now + 60_000 && validUntil > now;
    const values = endpointContextValuesSchema.safeParse({ [key]: reading.value });
    view.fields[key as EndpointContextField] = { status: !usable ? (validUntil <= now ? 'stale' : 'unavailable')
      : values.success && reading.value !== undefined ? 'fresh' : 'unavailable', capturedAt: reading.capturedAt, validUntil,
      ...(usable && values.success && reading.value !== undefined ? { value: values.data[key as EndpointContextField] } : {}) };
  }
  return view;
}

/** Reserved boundary: applying personal context requires a separate consumer grant. */
export interface PhoneEnvironmentApplicationRequest {
  phoneRef: string;
  purpose: 'phone_task';
  bindings: Array<{ field: 'physical.location' | 'environment.timezone' | 'environment.locale'; valueRef: string }>;
}
export interface PhoneEnvironmentAdapter {
  readonly supportedFields: readonly PhoneEnvironmentApplicationRequest['bindings'][number]['field'][];
  apply(request: PhoneEnvironmentApplicationRequest, signal: AbortSignal): Promise<{
    status: 'unsupported' | 'pending' | 'verified' | 'unknown'; applicationRef?: string;
  }>;
}
