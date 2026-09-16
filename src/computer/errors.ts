import type { ComputerWindow } from '@xopcai/computer-control-contract';
import { z } from 'zod';

export const ComputerDiagnosticSchema = z.object({
  errorCode: z.string().regex(/^COMPUTER_[A-Z_0-9]+$/).max(100),
  phase: z.enum(['frame_upload', 'observe', 'model', 'dispatch']),
  diagnosticId: z.uuid(),
  httpStatus: z.number().int().min(100).max(599).optional(),
}).strict();

export class ComputerOperationError extends Error {
  constructor(diagnostic: z.infer<typeof ComputerDiagnosticSchema>) {
    super(JSON.stringify(ComputerDiagnosticSchema.parse(diagnostic)));
    this.name = 'ComputerOperationError';
  }
}

/** Only typed, bounded diagnostics cross the endpoint transport; never forward raw exceptions. */
export function computerDiagnostic(error: unknown): z.infer<typeof ComputerDiagnosticSchema> | undefined {
  if (!(error instanceof Error) || error.message.length > 1000) return;
  try { return ComputerDiagnosticSchema.safeParse(JSON.parse(error.message)).data; } catch { return; }
}

export class ComputerTargetError extends Error {
  constructor(code: string, readonly windows: ComputerWindow[] = []) { super(code); }
}

/** Recovery instructions are deterministic; never replay an input with unknown delivery. */
export function computerRecovery(code: string): string {
  if (code.startsWith('COMPUTER_FRAME_UPLOAD_')) {
    return 'Screenshot upload to the Gateway failed. No automatic retry. Report the diagnosticId and HTTP status; do not change model providers or bypass desktop controls.';
  }
  switch (code) {
    case 'COMPUTER_RELEASE_UNCONFIRMED': return 'Desktop release was not confirmed. Do not switch to other tools. Stop desktop control locally or restore the endpoint connection, then call close again to confirm release.';
    case 'COMPUTER_MODEL_HTTP_429': return 'The configured model service is rate-limited. No input was dispatched from this model request. Check the service quota and retry only after it resets; do not automatically change providers.';
    case 'COMPUTER_MODEL_HTTP_409': return 'The pinned model deployment changed. No input was dispatched from this model request. Refresh the model catalog and reopen after reviewing the configured screenshot recipient.';
    case 'COMPUTER_OBSERVATION_CHANGED': return 'No input was dispatched. Observe the changed window and re-plan with fresh evidence; the old approved action was discarded.';
    case 'COMPUTER_UI_UNSTABLE': return 'No input was dispatched by the unstable attempts. The window changed repeatedly during prediction. Wait for a local state change, then discover/open again; never replay old coordinates.';
    case 'COMPUTER_NO_PROGRESS': return 'Repeated inputs produced no observed progress. Inspect the actual outcome and change the plan; do not keep clicking or repeat a potentially submitted action.';
    case 'COMPUTER_INVALID_INPUT': return 'Read tool_manual(computer_use) and use only the fields documented for this operation. Start with discover; open requires appRef, mode and prepare.';
    case 'COMPUTER_APP_INSTANCE_AMBIGUOUS': return 'Multiple processes for this app are running. Ask the user to keep the intended app instance open; do not guess a process.';
    case 'COMPUTER_READ_ONLY_MODEL_OUTPUT': return 'The GUI model did not provide a read-only answer. No input was executed. Report the limitation; do not retry as an action or change providers.';
    case 'COMPUTER_APP_REF_EXPIRED': return 'Discover the named app again, then use the returned appRef.';
    case 'COMPUTER_APP_NOT_FOUND': return 'Discover again. If absent, ask the user to install the app; do not guess an identifier.';
    case 'COMPUTER_APP_NOT_RUNNING': return 'Open with prepare=true only if the user requested launching the app; otherwise ask them to open it.';
    case 'COMPUTER_WINDOW_REQUIRED': return 'No visible target window. If the task permits bringing the app forward, open with prepare=true; otherwise ask the user to show the window. If preparation already failed, require a local state change before retrying.';
    case 'COMPUTER_WINDOW_AMBIGUOUS': return 'Choose a returned windowRef only when its title matches the task. Otherwise ask the user using window titles, not IDs.';
    case 'COMPUTER_WINDOW_CHANGED': return 'The selected window no longer exists. Discover and open again; never reuse its coordinates.';
    case 'COMPUTER_READ_ONLY': return 'This session is read-only. Do not retry an action or reopen in control mode without user authorization.';
    case 'COMPUTER_DEVICE_BUSY': case 'COMPUTER_BUSY': return 'Another desktop operation is active. Wait for it to finish; do not stop another task.';
    case 'COMPUTER_CONTROL_PAUSED': case 'COMPUTER_LOCAL_UI_REQUIRED': return 'Ask the user to resume desktop control locally. Do not automatically resume or bypass this stop.';
    case 'COMPUTER_OS_PERMISSION_REQUIRED': return 'Ask the user to check Accessibility and Screen Recording in macOS settings.';
    default: return 'Do not repeat the same call without a state change. Report this error; never bypass desktop restrictions with shell or other tools.';
  }
}
