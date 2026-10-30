import type { ComputerWindow } from '@xopcai/computer-control-contract';
import { z } from 'zod';

const ValidationActionSchema = z.enum(['unknown', 'activate', 'activate_sequence', 'batch', 'show_menu', 'set_value',
    'left_click', 'right_click', 'double_click', 'type', 'key', 'scroll', 'hscroll', 'wait',
    'terminate', 'answer', 'interact', 'showMenu', 'click', 'drag', 'setValue', 'typeText',
    'pressKeys', 'activateSequence', 'finished', 'takeover', 'button_plan']);

export const ComputerValidationSchema = z.object({
  action: ValidationActionSchema,
  stage: z.enum(['schema', 'converted_action', 'typing_target', 'keyboard', 'plan']),
  issues: z.array(z.object({
    path: z.array(z.union([z.enum(['unknown_field', 'name', 'arguments', 'proposal', 'action', 'kind',
      'actions', 'refs', 'ref', 'text', 'coordinate', 'keys', 'pixels', 'time', 'status', 'point',
      'x', 'y', 'button', 'count', 'from', 'to', 'deltaX', 'deltaY', 'durationMs', 'claimedSuccess',
      'reason', 'steps', 'label', 'when', 'role', 'value']), z.number().int().min(0).max(16384)])).max(10),
    code: z.enum(['invalid_type', 'invalid_value', 'invalid_union', 'unrecognized_keys', 'too_small',
      'too_big', 'invalid_format', 'not_multiple_of', 'custom', 'missing_point', 'outside_frame',
      'editable_target_missing', 'editable_target_ambiguous', 'invalid_context', 'unsupported_key', 'plan_not_grounded']),
    action: ValidationActionSchema,
  }).strict()).max(4),
}).strict();

export const ComputerStabilitySchema = z.object({
  stage: z.enum(['initial_capture', 'pre_dispatch', 'post_action']),
  samples: z.number().int().min(1).max(6),
  action: ValidationActionSchema.optional(),
  changes: z.array(z.enum(['window_identity', 'window_geometry', 'image_dimensions',
    'accessibility_structure', 'accessibility_text', 'accessibility_state', 'accessibility_geometry',
    'visual_or_unexposed_state', 'deadline'])).max(9),
  changedElementIndices: z.array(z.number().int().nonnegative().max(16384)).max(8),
}).strict();

export const ComputerDiagnosticSchema = z.object({
  errorCode: z.string().regex(/^COMPUTER_[A-Z_0-9]+$/).max(100),
  phase: z.enum(['frame_upload', 'observe', 'model', 'dispatch']),
  diagnosticId: z.uuid(),
  validationReason: z.enum(['invalid_json', 'invalid_arguments', 'missing_call', 'multiple_calls', 'invalid_envelope', 'output_limit']).optional(),
  validation: ComputerValidationSchema.optional(),
  stability: ComputerStabilitySchema.optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  requestId: z.string().regex(/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i).optional(),
  serviceErrorCode: z.enum(['max_input_tokens_exceeded', 'max_tokens_exceeded', 'model_capability_unsupported',
    'unsupported_request_field', 'invalid_image', 'request_too_large', 'invalid_request',
    'free_pool_unavailable', 'provider_error']).optional(),
}).strict();

export class ComputerOperationError extends Error {
  constructor(diagnostic: z.infer<typeof ComputerDiagnosticSchema>) {
    super(JSON.stringify(ComputerDiagnosticSchema.parse(diagnostic)));
    this.name = 'ComputerOperationError';
  }
}

/** Only typed, bounded diagnostics cross the endpoint transport; never forward raw exceptions. */
export function computerDiagnostic(error: unknown): z.infer<typeof ComputerDiagnosticSchema> | undefined {
  if (!(error instanceof Error) || error.message.length > 4096) return;
  try { return ComputerDiagnosticSchema.safeParse(JSON.parse(error.message)).data; } catch { return; }
}

export class ComputerTargetError extends Error {
  constructor(code: string, readonly windows: ComputerWindow[] = []) { super(code); }
}

export const ComputerRecoverySchema = z.object({
  action: z.enum(['wait_and_observe', 'show_target_window', 'move_to_same_desktop', 'show_xopc_window',
    'check_capture_permission', 'manual_input', 'reselect_window', 'inspect_result']),
  automaticRetryAllowed: z.boolean(),
}).strict();

/** Derived locally, so older desktop transports need no new reply fields. */
export function computerRecoveryDirective(code: string, dispatch: 'notStarted' | 'started' | 'completed' | 'unknown' = 'notStarted'): z.infer<typeof ComputerRecoverySchema> {
  if (dispatch === 'unknown' || dispatch === 'started') return { action: 'inspect_result', automaticRetryAllowed: false };
  if (/^COMPUTER_DRIVER_(CLICK|TYPE_TEXT|SET_VALUE|PRESS_KEY|HOTKEY|KEY|SCROLL|DRAG)_REFUSED$/.test(code)) {
    return { action: 'manual_input', automaticRetryAllowed: false };
  }
  const actions: Record<string, z.infer<typeof ComputerRecoverySchema>['action']> = {
    COMPUTER_WINDOW_HIDDEN: 'show_target_window', COMPUTER_WINDOW_READY_TIMEOUT: 'show_target_window',
    COMPUTER_WINDOW_REQUIRED: 'show_target_window', COMPUTER_WINDOW_OTHER_SPACE: 'move_to_same_desktop',
    COMPUTER_DRIVER_BRING_TO_FRONT_REFUSED: 'show_target_window',
    COMPUTER_APP_PREPARATION_REFUSED: 'show_target_window', COMPUTER_APP_ID_INVALID: 'inspect_result',
    COMPUTER_LOCAL_UI_REQUIRED: 'show_xopc_window', COMPUTER_CAPTURE_UNAVAILABLE: 'wait_and_observe',
    COMPUTER_CAPTURE_REQUIRED: 'wait_and_observe', COMPUTER_OS_PERMISSION_REQUIRED: 'check_capture_permission',
    COMPUTER_BACKGROUND_INPUT_UNSUPPORTED: 'manual_input', COMPUTER_INPUT_REFUSED: 'manual_input',
    COMPUTER_WINDOW_CHANGED: 'reselect_window', COMPUTER_CAPTURE_TARGET_MISMATCH: 'reselect_window',
  };
  return { action: Object.hasOwn(actions, code) ? actions[code] : 'inspect_result', automaticRetryAllowed: false };
}

/** Recovery instructions are deterministic; never replay an input with unknown delivery. */
export function computerRecovery(code: string): string {
  if (code === 'COMPUTER_AGENT_MODEL_REQUIRED') return 'Direct UI programs require an active visual main-model turn. Select a visual model and open with planner:agent; do not change models inside an active desktop session.';
  if (code === 'COMPUTER_AGENT_MODEL_CHANGED' || code === 'COMPUTER_PLANNER_MISMATCH') return 'The requested UI planner does not match the active session. Close and confirm release before opening the requested mode with the current main model.';
  if (code === 'COMPUTER_PROGRAM_UNAWAITED_CALL') return 'The program ended with an unawaited UI call. Earlier inputs may already have completed. Control was released. Reopen and observe current state before performing only the remaining authorized actions; never replay the script. Await every ui.* call, including emitScreenshot. observe({visual:true}) already attaches the screenshot.';
  if (code.startsWith('COMPUTER_PROGRAM_')) return 'The UI program stopped. Inspect completed receipts and the report before continuing with a new program for only the remaining work. Never replay the entire script or bypass a policy refusal.';
  if (code === 'COMPUTER_RECEIPT_MISMATCH') return 'The receipt could not be matched to the dispatched action, so its outcome is uncertain. Inspect the application locally; never automatically retry or replay the input. Wait for confirmed release before switching tools.';
  if (code === 'COMPUTER_FLOW_NOT_FOUND' || code === 'COMPUTER_FLOW_TARGET_MISMATCH') return 'The saved flow is unavailable or belongs to another application/device. Do not replay it or switch targets automatically. List flows and inspect the authorized target before planning again.';
  if (code === 'COMPUTER_FLOW_NOT_VERIFIED' || code === 'COMPUTER_FLOW_SAVE_FAILED') return 'Control was released. No reusable flow was confirmed saved. Saving requires verified native navigation, non-sensitive labels and working local storage; never repeat desktop input merely to save a flow.';
  if (code.startsWith('COMPUTER_FRAME_UPLOAD_')) {
    return 'Screenshot upload to the Gateway failed. No automatic retry. Report the diagnosticId and HTTP status; do not change model providers or bypass desktop controls.';
  }
  switch (code) {

    case 'COMPUTER_NATIVE_BATCH_FAILED': case 'COMPUTER_DRIVER_INVALID_BATCH_RESULT':
      return 'The native batch stopped or its reply could not be validated. Inspect per-input receipts and the current window after releasing control. Completed or unknown inputs must never be replayed; do not retry the batch through scalar calls.';
    case 'COMPUTER_NATIVE_BATCH_REFUSED':
      return 'The native driver rejected the batch before any input. Inspect the exact target, native capability and batch arguments; do not bypass this refusal through scalar calls.';

    case 'COMPUTER_WINDOW_HIDDEN': return 'The selected window is hidden or minimized. If restoration is already authorized, open with prepare=true after release; otherwise ask the user to show it. Keyboard focus is not required. Never replay prior inputs.';
    case 'COMPUTER_WINDOW_READY_TIMEOUT': return 'Automatic application preparation did not produce a verified ready window within five seconds. No task input was sent during preparation. Report the preparation failure and inspect local diagnostics. Resume only after a relevant application or desktop state change; do not repeat activation unchanged or bypass the window checks.';
    case 'COMPUTER_APP_PREPARATION_REFUSED': return 'The desktop host could not complete the authorized system application-open request. No task input was sent. Inspect application availability and local host state before retrying; do not replace the request with paths, URLs or arbitrary command arguments.';
    case 'COMPUTER_APP_ID_INVALID': return 'The application identity is not a valid native bundle identifier. Discover the intended application again and use its issued appRef; do not ask the user to supply a bundle id or substitute a path or URL.';
    case 'COMPUTER_CAPTURE_UNAVAILABLE': case 'COMPUTER_CAPTURE_REQUIRED': return 'The selected window could not provide a usable screenshot after bounded capture attempts. This does not establish missing permissions or another desktop. Inspect its visibility and the action receipt; a completed input must not be replayed. Reopen and observe after a local state change.';
    case 'COMPUTER_CAPTURE_TARGET_MISMATCH': return 'The captured native window does not match the selected target. Control is stopped. Select the intended window again; do not reuse refs, coordinates or replay prior inputs.';
    case 'COMPUTER_BACKGROUND_INPUT_UNSUPPORTED': return 'The native driver explicitly reports that this input cannot be delivered in the background. Complete this step manually; do not switch to foreground/global injection or replay it.';
    case 'COMPUTER_INPUT_REFUSED': return 'The application refused this input without an established cause. Inspect the receipt and actual result; do not infer that foreground focus will fix it or automatically replay input.';

    case 'COMPUTER_WINDOWS_TEXT_INPUT_UNVERIFIED': case 'COMPUTER_WINDOWS_KEY_INPUT_UNVERIFIED':
      return 'This Windows control cannot be certified for safe input. Ask the user to enter text manually. Do not substitute key presses, paste, shell commands, coordinates or another tool to bypass this refusal.';
    case 'COMPUTER_WINDOWS_KEY_TARGET_REQUIRED':
      return 'Keyboard input requires one verified non-password control focused inside the authorized window. Observe or focus the intended safe control before a new proposal; never send keys to another window or bypass the refusal with global input.';
    case 'COMPUTER_WINDOWS_KEY_TARGET_CHANGED': case 'COMPUTER_WINDOWS_EDIT_TARGET_CHANGED':
      return 'The native input target or its safety state changed before dispatch. Inspect the actual application and release this operation. Do not replay an uncertain input or switch to global keys, paste or shell input.';
    case 'COMPUTER_WINDOW_APP_CHANGED':
      return 'The native window no longer belongs to the authorized application. Stop and select the intended application again. A shared Windows host process does not authorize its other app windows. Do not reuse old refs or replay uncertain input.';
    case 'COMPUTER_NATIVE_IDENTITY_UNAVAILABLE':
      return 'The desktop cannot verify the native target identity in the current interactive session. Check that the app and xopc are on the same signed-in desktop. Do not bypass this check or automatically elevate privileges.';
    case 'COMPUTER_PLATFORM_UNSUPPORTED':
      return 'This desktop build does not support Computer Use on this platform or architecture. Use a supported macOS or Windows x64 desktop build.';
    case 'COMPUTER_ELEMENT_REF_REQUIRED': case 'COMPUTER_ELEMENT_TARGET_CHANGED':
    case 'COMPUTER_SEMANTIC_ACTION_UNSUPPORTED':
      return 'The native element reference or action is unavailable for this window. No automatic coordinate fallback. Reopen and observe fresh evidence before choosing a different action; never reuse an old reference or replay an uncertain input.';
    case 'COMPUTER_SEMANTIC_ACTION_UNCONFIRMED':
      return 'The native action returned uncertain execution evidence. Inspect the application before continuing. Do not repeat it or fall back to coordinates; its effect may already have occurred.';
    case 'COMPUTER_INVALID_MODEL_OUTPUT': case 'COMPUTER_EXPECTED_SINGLE_ACTION':
      return 'The GUI model returned an invalid action after bounded format correction. No input from this prediction was dispatched. Report validationReason, validation (action, stage and field issues) and diagnosticId; do not guess coordinates, replay the action or change providers.';
    case 'COMPUTER_MODEL_HTTP_400': return 'The configured model service rejected the request. No input was dispatched from this model request. Report serviceErrorCode, requestId and diagnosticId; check the model request format and input/output limits before reopening. Do not automatically retry or change providers.';
    case 'COMPUTER_RELEASE_UNCONFIRMED': return 'Desktop release was not confirmed. Do not switch to other tools. Stop desktop control locally or restore the endpoint connection, then call close again to confirm release.';
    case 'COMPUTER_DRIVER_CLEANUP_UNCONFIRMED': return 'The private desktop driver did not confirm shutdown. The old grant is revoked and a new driver cannot start. Stop desktop control locally and confirm cleanup before reopening; never replay the previous input.';
    case 'COMPUTER_DRIVER_HOTKEY_REFUSED': case 'COMPUTER_DRIVER_PRESS_KEY_REFUSED': case 'COMPUTER_DRIVER_KEY_REFUSED':
      return 'The native key delivery was refused and desktop control is stopped. Inspect the application locally and complete the key operation manually. Never replay it or switch to foreground/global key injection to bypass the refusal.';
    case 'COMPUTER_MODEL_HTTP_429': return 'The configured model service is rate-limited. No input was dispatched from this model request. Check the service quota and retry only after it resets; do not automatically change providers.';
    case 'COMPUTER_MODEL_HTTP_409': return 'The pinned model deployment changed. No input was dispatched from this model request. Refresh the model catalog and reopen after reviewing the configured screenshot recipient.';
    case 'COMPUTER_OBSERVATION_CHANGED': return 'No input was dispatched. Observe the changed window and re-plan with fresh evidence; the old proposed action was discarded.';
    case 'COMPUTER_UI_UNSTABLE': return 'Report stability.stage, changes and samples with diagnosticId. initial_capture means no stable observation was obtained; pre_dispatch means the proposed input was not dispatched and rescue is exhausted; post_action means an input completed but its resulting view did not settle. Check receipts and completedInputs for earlier inputs; do not replay them. Wait for a local state change before reopening; never reuse old coordinates.';
    case 'COMPUTER_NO_PROGRESS': return 'Repeated inputs produced no observed progress. Inspect the actual outcome and change the plan; do not keep clicking or repeat a potentially submitted action.';
    case 'COMPUTER_INVALID_INPUT': return 'Read tool_manual(computer_use) and use only the fields documented for this operation. Start with discover; open requires appRef, mode and prepare.';
    case 'COMPUTER_APP_INSTANCE_AMBIGUOUS': return 'Multiple processes for this app are running. Ask the user to keep the intended app instance open; do not guess a process.';
    case 'COMPUTER_READ_ONLY_MODEL_OUTPUT': return 'The GUI model did not provide a read-only answer. No input was executed. Report the limitation; do not retry as an action or change providers.';
    case 'COMPUTER_APP_REF_EXPIRED': return 'Discover the named app again, then use the returned appRef.';
    case 'COMPUTER_APP_NOT_FOUND': return 'Discover again. If absent, ask the user to install the app; do not guess an identifier.';
    case 'COMPUTER_APP_NOT_AUTHORIZED': return 'This application has not been authorized in the local Computer Use settings. Tell the user where to configure access. Do not request a chat approval or try another control route.';
    case 'COMPUTER_APP_NOT_RUNNING': return 'Open with prepare=true only if the user requested launching the app; otherwise ask them to open it.';
    case 'COMPUTER_WINDOW_OTHER_SPACE': return 'The target window is on another macOS desktop/Space and automatic exact-window recovery is unavailable or did not succeed. Current desktop hosts temporarily let chat follow Spaces and reveal the existing authorized window without replaying input. Check host support and the returned failure before asking for a manual workspace change; do not retry unchanged or bypass visibility checks.';
    case 'COMPUTER_WINDOW_REQUIRED': return 'No visible target window. If the task permits bringing the app forward, open with prepare=true; otherwise ask the user to show the window. If preparation already failed, require a local state change before retrying.';
    case 'COMPUTER_DRIVER_BRING_TO_FRONT_REFUSED': return 'The native driver refused to activate the app window. Ask the user to bring the intended window to the foreground locally, then discover and open it with prepare=false. Do not repeat prepare=true or use another control route.';
    case 'COMPUTER_WINDOW_AMBIGUOUS': return 'Choose a returned windowRef only when its title matches the task. Otherwise ask the user using window titles, not IDs.';
    case 'COMPUTER_WINDOW_CHANGED': return 'The selected window no longer exists. Discover and open again; never reuse its coordinates.';
    case 'COMPUTER_READ_ONLY': return 'This session is read-only. Do not retry an action or reopen in control mode without user authorization.';
    case 'COMPUTER_DEVICE_BUSY': case 'COMPUTER_BUSY': return 'Another desktop operation is active. Wait for it to finish; do not stop another task.';
    case 'COMPUTER_LOCAL_UI_REQUIRED': return 'Ask the user to show the xopc desktop window before starting a new desktop task.';
    case 'COMPUTER_OS_PERMISSION_REQUIRED': return 'Check local desktop access. On macOS, review Accessibility and Screen Recording. On Windows, use the signed-in interactive desktop and inspect the driver diagnostic; do not request macOS permissions or automatically elevate privileges.';
    default: return 'Do not repeat the same call without a state change. Report this error; never bypass desktop restrictions with shell or other tools.';
  }
}
