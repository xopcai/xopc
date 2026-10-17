import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ComputerAction, ComputerObservation, ComputerReceipt } from '@xopcai/computer-control-contract';
import { ComputerDiagnosticSchema, computerDiagnostic } from './errors.js';
import type { ComputerVerification } from './task-state.js';

export const ComputerFailurePhaseSchema = z.enum(['open', 'observe', 'frame_upload', 'model', 'dispatch', 'release', 'executor', 'oracle']);
export type ComputerFailurePhase = z.infer<typeof ComputerFailurePhaseSchema>;
export const ComputerFailureCategorySchema = z.enum(['permission', 'target', 'observation', 'model', 'transport', 'native', 'budget', 'no_progress', 'cancelled', 'harness', 'unknown']);
export const ComputerFailureSchema = z.object({
  category: ComputerFailureCategorySchema, phase: ComputerFailurePhaseSchema,
  errorCode: z.string().regex(/^COMPUTER_[A-Z_0-9]+$/).max(100),
  dispatch: z.enum(['notStarted', 'started', 'completed', 'unknown']),
  diagnosticId: z.uuid().optional(), httpStatus: z.number().int().min(100).max(599).optional(),
  requestId: z.string().regex(/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i).optional(),
  validationReason: ComputerDiagnosticSchema.shape.validationReason,
  serviceErrorCode: ComputerDiagnosticSchema.shape.serviceErrorCode,
}).strict();
export type ComputerFailure = z.infer<typeof ComputerFailureSchema>;

const categories: Record<string, ComputerFailure['category']> = Object.create(null);
for (const [category, codes] of Object.entries({
  permission: ['DISABLED', 'READ_ONLY', 'LOCAL_UI_REQUIRED', 'CONTROL_PAUSED', 'APP_NOT_AUTHORIZED', 'OS_PERMISSION_REQUIRED', 'SELF_CONTROL_DENIED', 'SENSITIVE_APP_MANUAL_ONLY', 'REVOKED', 'GRANT_REVOKED', 'KEY_SCOPE_UNSAFE'],
  target: ['APP_NOT_FOUND', 'APP_NOT_RUNNING', 'APP_REF_EXPIRED', 'APP_INSTANCE_AMBIGUOUS', 'WINDOW_REQUIRED', 'WINDOW_AMBIGUOUS', 'WINDOW_CHANGED', 'WINDOW_ID_UNSUPPORTED', 'PROCESS_CHANGED', 'PROCESS_EXITED', 'ELEMENT_REF_REQUIRED', 'ELEMENT_TARGET_CHANGED', 'TARGET_CHANGED', 'TARGET_MISMATCH', 'CLOSE_BEFORE_TARGET_CHANGE', 'FLOW_TARGET_MISMATCH', 'FLOW_NOT_FOUND', 'DESKTOP_BINDING_REQUIRED', 'DESKTOP_UPGRADE_REQUIRED'],
  observation: ['OBSERVATION_CHANGED', 'STALE_OBSERVATION', 'STALE_ACTION', 'UI_UNSTABLE', 'FRAME_REQUIRED', 'CAPTURE_REQUIRED', 'CAPTURE_TARGET_MISMATCH', 'FRAME_HANDOFF_FAILED', 'UNEXPECTED_FRAME', 'SESSION_MISMATCH', 'AMBIGUOUS_WINDOW_TREE', 'OBSERVE_FAILED'],
  model: ['MODEL_REQUIRED', 'MODEL_KEY_MISSING', 'MODEL_CAPABILITY_REQUIRED', 'INVALID_MODEL_OUTPUT', 'EXPECTED_SINGLE_ACTION', 'READ_ONLY_MODEL_OUTPUT', 'MODEL_FAILED', 'MODEL_EMPTY_RESPONSE', 'MODEL_INCOMPLETE_RESPONSE', 'MODEL_INVALID_JSON', 'MODEL_PROTOCOL_MISMATCH', 'MODEL_REQUIRES_HTTPS_ORIGIN', 'UNSUPPORTED_MODEL_HEADER', 'DEPLOYMENT_UNAVAILABLE'],
  transport: ['RECEIPT_MISMATCH', 'DISPATCH_FAILED', 'RELEASE_UNCONFIRMED', 'SESSION_NOT_FOUND', 'BUSY', 'DEVICE_BUSY', 'NOT_READY', 'ACTION_ID_REUSED', 'ACTION_PENDING', 'DIFFERENT_ACTION_PENDING'],
  native: ['NATIVE_SETUP_FAILED', 'NATIVE_ACTION_FAILED', 'POST_ACTION_OBSERVATION_FAILED', 'SEMANTIC_ACTION_UNSUPPORTED', 'SEMANTIC_ACTION_UNCONFIRMED', 'EDITABLE_TARGET_REQUIRED', 'COORDINATE_OUTSIDE_WINDOW', 'KEY_NOT_SUPPORTED', 'SCROLL_REQUIRES_ONE_AXIS', 'DRAG_REQUIRES_MOVEMENT', 'DRIVER_HOST_IDENTITY_MISMATCH', 'DRIVER_INVALID_RESULT', 'DRIVER_OFFLINE', 'DRIVER_REQUIRES_ELECTRON_MAIN'],
  budget: ['SESSION_BUDGET', 'ACTION_BUDGET', 'MODEL_BUDGET', 'FRAME_LIMIT', 'INPUT_LIMIT', 'MODEL_OUTPUT_BUDGET', 'MODEL_RESPONSE_LIMIT'],
  no_progress: ['NO_PROGRESS'], cancelled: ['OPERATION_ABORTED', 'AUTHORIZATION_TIMEOUT', 'EVALUATION_ABORTED'],
  harness: ['EVALUATION_PROCESS_FAILED', 'EVALUATION_TIMEOUT', 'EVALUATION_OUTPUT_LIMIT', 'EVALUATION_INVALID_JSON', 'EVALUATION_INVALID_RESULT'],
})) for (const code of codes) categories[`COMPUTER_${code}`] = category as ComputerFailure['category'];

/** Unknown exception prose and arbitrary code-like strings never become report data. */
export function classifyComputerFailure(error: unknown, phase: ComputerFailurePhase,
  dispatch: ComputerFailure['dispatch'] = 'notStarted', aborted = false): ComputerFailure {
  const diagnostic = computerDiagnostic(error);
  let errorCode = diagnostic?.errorCode ?? (error instanceof Error ? error.message : '');
  if (aborted && !categories[errorCode] && !diagnostic) errorCode = 'COMPUTER_OPERATION_ABORTED';
  let category = categories[errorCode];
  if (/^COMPUTER_MODEL_HTTP_[1-5]\d\d$/.test(errorCode)) category = 'model';
  if (/^COMPUTER_FRAME_UPLOAD_(HTTP_[1-5]\d\d|INVALID_GRANT|TOO_LARGE|TIMEOUT|NETWORK|INVALID_IMAGE|BUSY|INVALID_RESPONSE)$/.test(errorCode)) category = 'transport';
  if (/^COMPUTER_DRIVER_(CLICK|SET_VALUE|TYPE_TEXT|DRAG|BRING_TO_FRONT|LAUNCH_APP)_REFUSED$/.test(errorCode)
    || /^COMPUTER_DRIVER_SETUP_(START|BINARY|SDK|IDENTITY|PERMISSIONS)_FAILED$/.test(errorCode)) category = 'native';
  if (!category) { category = 'unknown'; errorCode = 'COMPUTER_OPERATION_FAILED'; }
  return { category, errorCode, phase: diagnostic?.phase === 'frame_upload' ? 'frame_upload' : phase, dispatch,
    ...(diagnostic ? { diagnosticId: diagnostic.diagnosticId, httpStatus: diagnostic.httpStatus, requestId: diagnostic.requestId,
      validationReason: diagnostic.validationReason, serviceErrorCode: diagnostic.serviceErrorCode } : {}) };
}

const Count = z.number().int().nonnegative();
const CountersSchema = z.object({
  observations: Count, predictionAttempts: Count, modelRequests: Count, proposedInputs: Count, completedInputs: Count,
  unknownDispatches: Count, unchangedInputs: Count, observationChanges: Count,
  rescueAttempts: Count, rescueExhaustions: Count,
  takeovers: Count, successClaims: Count, verifiedConditions: Count,
}).strict();
export const ComputerSessionReportSchema = z.object({
  version: z.literal(1), reportId: z.uuid(), sessionId: z.uuid().optional(),
  status: z.enum(['active', 'released', 'release_unconfirmed']),
  startedAt: Count, durationMs: z.number().finite().nonnegative(),
  counters: CountersSchema,
  phaseMs: z.object({ open: Count, observe: Count, model: Count, dispatch: Count, release: Count }).strict(),
  failure: ComputerFailureSchema.optional(),
  recentActions: z.array(z.object({
    kind: z.enum(['activate', 'showMenu', 'click', 'drag', 'setValue', 'typeText', 'pressKeys', 'scroll', 'wait']),
    dispatch: z.enum(['notStarted', 'started', 'completed', 'unknown']),
    outcome: z.enum(['applied', 'notApplied', 'unknown']),
    unchanged: z.boolean(), condition: z.enum(['satisfied', 'not_met', 'unavailable']).optional(),
  }).strict()).max(12),
}).strict();
export type ComputerSessionReport = z.infer<typeof ComputerSessionReportSchema>;

/** A bounded metadata-only companion to task history; it never retains action arguments or pixels. */
export class ComputerSessionDiagnostics {
  private readonly data: ComputerSessionReport;
  private readonly receipts = new Set<string>();
  private pending?: { id: string; kind: ComputerAction['kind'] };
  private endedAt?: number;
  phase: ComputerFailurePhase = 'open';
  constructor(private readonly now: () => number = Date.now) {
    this.data = { version: 1, reportId: randomUUID(), status: 'active', startedAt: now(), durationMs: 0,
      counters: { observations: 0, predictionAttempts: 0, modelRequests: 0, proposedInputs: 0, completedInputs: 0, unknownDispatches: 0,
        unchangedInputs: 0, observationChanges: 0, rescueAttempts: 0, rescueExhaustions: 0,
        takeovers: 0, successClaims: 0, verifiedConditions: 0 },
      phaseMs: { open: 0, observe: 0, model: 0, dispatch: 0, release: 0 }, recentActions: [] };
  }
  bind(sessionId: string): void { this.data.sessionId = sessionId; }
  count(key: keyof ComputerSessionReport['counters']): void { this.data.counters[key]++; }
  async measure<T>(phase: keyof ComputerSessionReport['phaseMs'], fn: () => Promise<T>): Promise<T> {
    this.phase = phase;
    const start = this.now();
    try { return await fn(); }
    finally { this.data.phaseMs[phase] += Math.max(0, Math.round(this.now() - start)); }
  }
  propose(id: string, kind: ComputerAction['kind']): void {
    this.pending = { id, kind };
    if (kind !== 'wait') this.count('proposedInputs');
  }
  discard(): void { this.pending = undefined; this.count('observationChanges'); }
  record(receipt: ComputerReceipt, before?: ComputerObservation, after?: ComputerObservation, verification?: ComputerVerification): void {
    if (!this.pending || this.pending.id !== receipt.actionId || this.receipts.has(receipt.actionId)) return;
    this.receipts.add(receipt.actionId);
    const kind = this.pending.kind;
    const unchanged = kind !== 'wait' && receipt.dispatch === 'completed' && !!after && before?.stateDigest === after.stateDigest;
    if (kind !== 'wait' && receipt.dispatch === 'completed') this.count('completedInputs');
    if (receipt.dispatch === 'unknown' || receipt.dispatch === 'started') this.count('unknownDispatches');
    if (unchanged) this.count('unchangedInputs');
    this.verify(verification);
    this.data.recentActions.push({ kind, dispatch: receipt.dispatch, outcome: receipt.outcome, unchanged,
      ...(verification ? { condition: verification.status } : {}) });
    if (this.data.recentActions.length > 12) this.data.recentActions.shift();
    this.pending = undefined;
  }
  verify(verification?: ComputerVerification): void {
    if (verification?.status === 'satisfied' && !verification.preexisting) this.count('verifiedConditions');
  }
  fail(error: unknown, phase = this.phase, dispatch?: ComputerFailure['dispatch'], aborted = false): void {
    if (this.data.failure) return;
    if (this.pending && dispatch === undefined) this.count('unknownDispatches');
    this.data.failure = classifyComputerFailure(error, phase, dispatch ?? (this.pending ? 'unknown' : 'notStarted'), aborted);
  }
  finish(released: boolean): void {
    this.data.status = released ? 'released' : 'release_unconfirmed';
    if (released) this.endedAt ??= this.now();
  }
  snapshot(): ComputerSessionReport {
    return ComputerSessionReportSchema.parse({ ...this.data, durationMs: Math.max(0, (this.endedAt ?? this.now()) - this.data.startedAt) });
  }
}
