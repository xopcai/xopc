import { z } from 'zod';

export const PhoneProfileSchema = z.enum(['autoglm-phone-v1', 'structured-phone-v1']);
export const PhoneModelMetadataSchema = z.object({ profile: PhoneProfileSchema }).strict();
export const MOCK_PHONE_MODEL = 'phone-mock/settings-about';
export const MOCK_PHONE_GOAL = 'Open Android Settings and inspect About phone';

export const PhoneConfigSchema = z.object({
  enabled: z.boolean().default(false),
  adbPath: z.string().min(1).optional(),
  maxActionsPerSession: z.number().int().min(1).max(80).default(40),
  maxModelRequests: z.number().int().min(1).max(120).default(60),
  maxOperationDurationMs: z.number().int().min(1000).max(900_000).default(300_000),
  maxSessionDurationMs: z.number().int().min(1000).max(900_000).default(900_000),
}).strict().prefault({});
export type PhoneConfig = z.infer<typeof PhoneConfigSchema>;

export const PhoneDeviceSchema = z.object({
  id: z.string().uuid(), serial: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  appAccess: z.enum(['all', 'selected']).optional(),
  textInput: z.enum(['auto', 'manual']).optional(),
  allowedApps: z.array(z.string().regex(/^[a-zA-Z][\w]*(?:\.[\w]+)+$/)).max(500).default([]),
  connection: z.object({ kind: z.literal('aliyun-adb'), endpoint: z.string().max(200), credentialId: z.string().uuid() }).strict().optional(),
  createdAt: z.number(), revision: z.number().int().positive(),
}).strict();
export type PhoneDevice = z.infer<typeof PhoneDeviceSchema>;
export type PhoneApplication = { packageName: string; label: string };
export type PhoneTextInputStatus = { androidSdk: number; unicode: 'available' | 'setup_required' | 'unsupported'; method: 'scrcpy-clipboard' | 'provider-native'; keyboardRequired: false };
export type DiscoveredPhone = { serial: string; state: string; name: string; emulator: boolean };

const Point = z.array(z.number().finite().min(0).max(1000)).length(2);
export const PhoneActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('launch'), package: z.string().regex(/^[a-zA-Z][\w]*(?:\.[\w]+)+$/) }).strict(),
  z.object({ type: z.literal('tap'), point: Point }).strict(),
  z.object({ type: z.literal('doubleTap'), point: Point }).strict(),
  z.object({ type: z.literal('longPress'), point: Point, durationMs: z.number().int().min(100).max(3000).default(800) }).strict(),
  z.object({ type: z.literal('swipe'), start: Point, end: Point, durationMs: z.number().int().min(100).max(2000).default(500) }).strict(),
  z.object({ type: z.literal('typeText'), text: z.string().min(1).max(4000) }).strict(),
  z.object({ type: z.enum(['back', 'home']) }).strict(),
  z.object({ type: z.literal('wait'), durationMs: z.number().int().min(100).max(3000) }).strict(),
]);
export type PhoneAction = z.infer<typeof PhoneActionSchema>;
export const PhoneDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('action'), action: PhoneActionSchema }).strict(),
  z.object({ kind: z.literal('complete'), summary: z.string().max(1000) }).strict(),
  z.object({ kind: z.literal('needsUser'), reason: z.string().max(1000) }).strict(),
]);
export type PhoneDecision = z.infer<typeof PhoneDecisionSchema>;
export type PhoneElement = { text: string; description: string; resourceId: string; clickable: boolean; focused: boolean; password: boolean; editable?: boolean; bounds: [number, number, number, number] };
export type PhoneObservation = {
  frameId: string; capturedAt: number; width: number; height: number; rotation: number;
  package: string; frame: Buffer; elements: PhoneElement[];
};
export const PhoneInputSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('discover') }).strict(),
  z.object({ op: z.literal('open'), deviceId: z.string().uuid().optional(), mode: z.enum(['observe', 'control']), appPackage: z.string().regex(/^[a-zA-Z][\w]*(?:\.[\w]+)+$/).optional() }).strict(),
  z.object({ op: z.literal('observe') }).strict(),
  z.object({ op: z.enum(['run', 'step']), goal: z.string().trim().min(1).max(2000),
    scenario: z.literal('settings-about').optional(),
    expectText: z.string().min(1).max(200).optional(),
    maxActions: z.number().int().min(1).max(12).default(6),
  }).strict(),
  z.object({ op: z.enum(['status', 'pause', 'resume', 'cancel', 'close']) }).strict(),
]);
export type PhoneInput = z.infer<typeof PhoneInputSchema>;
export type PhoneStatus = 'ready' | 'running' | 'paused' | 'needs_user' | 'completed' | 'cancelled' | 'closed' | 'failed' | 'outcome_unknown';
export type PhoneReport = {
  sessionId: string; deviceId: string; deviceName: string; owner: string; agentId: string;
  modelRef: string; mock: boolean; mode: 'observe' | 'control'; status: PhoneStatus;
  actions: number; humanActions?: number; modelRequests: number; createdAt: number; updatedAt: number;
  verified: boolean; verificationLevel: 'none' | 'ui'; stopReason?: string; errorCode?: string;
  facts?: string[]; foregroundApp?: string; message?: string;
  steps: Array<{ action: PhoneAction['type']; at: number; dispatch: 'completed' | 'unknown'; actor?: 'agent' | 'human' }>;
  controlOwner?: 'agent' | 'human' | 'none'; controlEpoch?: number; handoff?: 'idle' | 'acquiring' | 'returning';
  currentAction?: PhoneAction['type'];
};

export class PhoneError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409 | 500 | 502 = 400) { super(message); }
}
