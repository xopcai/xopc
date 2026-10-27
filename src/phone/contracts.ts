import { z } from 'zod';

import type { PhonePerformance } from './execution-trace.js';

export const PhoneProfileSchema = z.enum(['autoglm-phone-v1', 'structured-phone-v1', 'doubao-seed-phone-v1', 'gui-owl-phone-v1']);
export const PhoneModelMetadataSchema = z.object({ profile: PhoneProfileSchema }).strict();
export const MOCK_PHONE_MODEL = 'phone-mock/settings-about';
export const MOCK_PHONE_GOAL = 'Open Android Settings and inspect About phone';

export const PhoneExecutionModeSchema = z.enum(['collaborative', 'direct']);
export type PhoneExecutionMode = z.infer<typeof PhoneExecutionModeSchema>;

export const PhoneConfigSchema = z.object({
  enabled: z.boolean().default(false),
  executionMode: PhoneExecutionModeSchema.default('collaborative'),
  adbPath: z.string().min(1).optional(),
  autoGlmPrompt: z.enum(['current', 'upstream']).default('current'),
  autoGlmProtocol: z.enum(['current', 'upstream']).default('current'),
  autoGlmSampling: z.enum(['current', 'upstream']).default('current'),
  modelResponseMode: z.enum(['json', 'stream']).default('json'),
  batchReadings: z.boolean().default(false),
  modelRepetitionGuard: z.boolean().default(false),
  semanticControls: z.boolean().default(false),
  hierarchicalPlanning: z.boolean().default(false),
  maxActionsPerSession: z.number().int().min(1).max(80).default(40),
  maxModelRequests: z.number().int().min(1).max(120).default(60),
  modelRequestTimeoutMs: z.number().int().min(1000).max(300_000).default(45_000),
  maxOperationDurationMs: z.number().int().min(1000).max(900_000).default(300_000),
  maxSessionDurationMs: z.number().int().min(1000).max(900_000).default(900_000),
  idleDisconnectMs: z.number().int().min(0).max(86_400_000).default(0),
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
  wireless: z.object({ guid: z.string().min(1).max(200), hardwareSerial: z.string().min(1).max(200), host: z.string().max(100), port: z.number().int().min(1).max(65535) }).strict().optional(),
  createdAt: z.number(), revision: z.number().int().positive(),
}).strict();
export type PhoneDevice = z.infer<typeof PhoneDeviceSchema>;
export type PhoneApplication = { packageName: string; label: string };
export type PhoneTextInputStatus = { androidSdk: number; unicode: 'available' | 'setup_required' | 'unsupported'; method: 'scrcpy-clipboard' | 'provider-native'; keyboardRequired: false };
export type DiscoveredPhone = { serial: string; state: string; name: string; emulator: boolean };

const Point = z.array(z.number().finite().min(0).max(1000)).length(2);
export const PhoneElementSelectorSchema = z.object({
  resourceId: z.string().min(1).max(300).optional(),
  text: z.string().min(1).max(4000).optional(),
  description: z.string().min(1).max(1000).optional(),
}).strict().refine(value => Boolean(value.resourceId || value.text || value.description), 'Specify an exact native element identity');
export type PhoneElementSelector = z.infer<typeof PhoneElementSelectorSchema>;
export type PhoneCapabilities = { semanticControls?: boolean; hierarchicalPlanning?: boolean };
export const PhoneActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('launch'), package: z.string().regex(/^[a-zA-Z][\w]*(?:\.[\w]+)+$/) }).strict(),
  z.object({ type: z.literal('tap'), point: Point }).strict(),
  z.object({ type: z.literal('tapElement'), frameId: z.string().min(1).max(200), selector: PhoneElementSelectorSchema }).strict(),
  z.object({ type: z.literal('doubleTap'), point: Point }).strict(),
  z.object({ type: z.literal('longPress'), point: Point, durationMs: z.number().int().min(100).max(3000).default(800) }).strict(),
  z.object({ type: z.literal('swipe'), start: Point, end: Point, durationMs: z.number().int().min(100).max(2000).default(500) }).strict(),
  z.object({ type: z.literal('typeText'), text: z.string().min(1).max(4000), mode: z.enum(['insert', 'replace']).optional() }).strict(),
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
export const PhoneCompletionSchema = z.object({
  appPackage: z.string().regex(/^[a-zA-Z][\w]*(?:\.[\w]+)+$/).optional(),
  textAny: z.array(z.string().min(1).max(200)).min(1).max(20).optional(),
  textAll: z.array(z.string().min(1).max(200)).min(1).max(20).optional(),
  field: z.object({ resourceId: z.string().min(1).max(300), value: z.string().max(4000) }).strict().optional(),
  requireChange: z.boolean().optional(),
}).strict().refine(value => value.appPackage || value.textAny || value.textAll || value.field, 'Specify at least one UI condition');
export type PhoneCompletion = z.infer<typeof PhoneCompletionSchema>;
export const PhoneRequestedOutputSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
  description: z.string().trim().min(1).max(300),
  selector: PhoneElementSelectorSchema.optional(),
}).strict();
export const PhoneTaskBudgetSchema = z.object({
  maxActions: z.number().int().min(1).max(80).optional(),
  maxModelRequests: z.number().int().min(1).max(120).optional(),
  maxActiveDurationMs: z.number().int().min(1000).max(900_000).optional(),
}).strict();
export type PhoneTaskBudget = z.infer<typeof PhoneTaskBudgetSchema>;
export const PhoneTaskFields = {
  budget: PhoneTaskBudgetSchema.optional(),
  taskId: z.string().uuid().optional(),
  executionMode: PhoneExecutionModeSchema.optional(),
  constraints: z.array(z.string().trim().min(1).max(500)).max(12).optional(),
  requestedOutputs: z.array(PhoneRequestedOutputSchema).max(8).refine(items => new Set(items.map(item => item.key)).size === items.length, 'Output keys must be unique').optional(),
};
export type PhoneRequestedOutput = z.infer<typeof PhoneRequestedOutputSchema>;
export type PhoneTaskContract = { taskId: string; executionMode: PhoneExecutionMode; goal: string;
  constraints: string[]; requestedOutputs: PhoneRequestedOutput[]; budget?: PhoneTaskBudget; completion?: PhoneCompletion; expectText?: string };
export type PhoneTaskFeedback = {
  taskId: string; segmentId: string; executionMode: PhoneExecutionMode;
  outcome: 'running' | 'completed' | 'partial' | 'blocked' | 'needs_user' | 'failed' | 'cancelled';
  stopReason?: string; verified: boolean; verificationLevel: 'none' | 'ui';
  progress: { completed: string[]; remaining: string[]; source: 'runtime' };
  outputs: Array<{ key: string; value?: string; source?: PhoneReading['source']; verification: PhoneReading['verification']; frameId?: string; capturedAt?: number; reason?: string }>;
  evidence: PhoneReading[];
  usage: { actions: number; modelRequests: number; activeDurationMs: number };
  nextAction: 'wait' | 'replan' | 'inspect' | 'user' | 'done';
};
export const PhoneInputSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('request_user'), reason: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ op: z.literal('discover') }).strict(),
  z.object({ op: z.literal('set_mode'), executionMode: PhoneExecutionModeSchema, applyCurrent: z.boolean().default(false) }).strict(),
  z.object({ op: z.literal('open'), deviceId: z.string().uuid().optional(), mode: z.enum(['observe', 'control']), appPackage: z.string().regex(/^[a-zA-Z][\w]*(?:\.[\w]+)+$/).optional(), settingsPage: z.literal('about-phone').optional() }).strict().refine(input => !input.settingsPage || input.mode === 'control' && input.appPackage === 'com.android.settings', 'About phone requires authorized Settings control'),
  z.object({ op: z.literal('observe'), goal: z.string().trim().min(1).max(2000).optional() }).strict(),
  z.object({ ...PhoneTaskFields, op: z.enum(['run', 'step']), goal: z.string().trim().min(1).max(2000),
    scenario: z.literal('settings-about').optional(),
    expectText: z.string().min(1).max(200).optional(),
    completion: PhoneCompletionSchema.optional(),
    maxActions: z.number().int().min(1).max(12).default(6),
  }).strict(),
  z.object({ op: z.enum(['status', 'pause', 'resume', 'cancel', 'close']) }).strict(),
]);
export type PhoneInput = z.infer<typeof PhoneInputSchema>;
export type PhoneStatus = 'ready' | 'running' | 'paused' | 'needs_user' | 'completed' | 'cancelled' | 'closed' | 'failed' | 'outcome_unknown';
export type PhoneReading = {
  source: 'native_ui' | 'screenshot';
  verification: 'observed' | 'unverified' | 'unavailable';
  text: string[]; frameId: string; capturedAt: number; reason?: string;
};
export type PhoneReport = {
  assistanceId?: string;
  assistanceVersion?: number;
  transcriptId?: string;
  revision?: number;
  hasPendingTask?: boolean;
  reconnectRequired?: boolean;
  sessionId: string; deviceId: string; deviceName: string; owner: string; agentId: string;
  modelRef: string; mock: boolean; mode: 'observe' | 'control'; status: PhoneStatus;
  actions: number; humanActions?: number; modelRequests: number; createdAt: number; updatedAt: number;
  verified: boolean; verificationLevel: 'none' | 'ui'; stopReason?: string; errorCode?: string;
  facts?: string[]; foregroundApp?: string; message?: string;
  goalPreview?: string;
  executionMode?: PhoneExecutionMode; nextExecutionMode?: PhoneExecutionMode;
  task?: PhoneTaskContract; feedback?: PhoneTaskFeedback;
  sourceConversationId?: string;
  readings?: PhoneReading[];
  performance?: PhonePerformance;
  steps: Array<{ action: PhoneAction['type']; at: number; dispatch: 'completed' | 'unknown'; actor?: 'agent' | 'human' }>;
  controlOwner?: 'agent' | 'human' | 'none'; controlEpoch?: number; handoff?: 'idle' | 'acquiring' | 'returning';
  currentAction?: PhoneAction['type'];
  diagnostics?: { stalePredictions: number; protocolRepairs: number; unchangedActions: number; completionCorrections: number;
    semanticActions?: number; semanticRejections?: number; plannedSubgoals?: number; completedSubgoals?: number;
    backReplans?: number; focusReplans?: number; focusRecoveries?: number; resumedTextInputs?: number;
    numericActions?: number; numericConfirmedSteps?: number; numericMismatches?: number };
};

export class PhoneError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409 | 500 | 502 = 400,
    readonly details?: { executionStarted: false; deviceId: string; occupancy: { kind: 'agent' | 'human' | 'opening' | 'inspection'; conversationId?: string; sessionId?: string }; retryPolicy: 'user_initiated' }) { super(message); }
}
