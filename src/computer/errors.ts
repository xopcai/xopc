import type { ComputerWindow } from '@xopcai/computer-control-contract';

export class ComputerTargetError extends Error {
  constructor(code: string, readonly windows: ComputerWindow[] = []) { super(code); }
}

/** Recovery instructions are deterministic; never replay an input with unknown delivery. */
export function computerRecovery(code: string): string {
  switch (code) {
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
