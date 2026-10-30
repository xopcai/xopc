import { describe, expect, it } from 'vitest';
import { computerRecovery, computerRecoveryDirective, ComputerRecoverySchema } from '../errors.js';
import { classifyComputerFailure } from '../diagnostics.js';
import { computerNativeInputError } from '../native-errors.js';

describe('desktop recovery classification', () => {
  it.each([
    ['COMPUTER_WINDOW_HIDDEN', 'target', 'show_target_window'],
    ['COMPUTER_WINDOW_READY_TIMEOUT', 'target', 'show_target_window'],
    ['COMPUTER_APP_PREPARATION_REFUSED', 'target', 'show_target_window'],
    ['COMPUTER_APP_ID_INVALID', 'target', 'inspect_result'],
    ['COMPUTER_WINDOW_OTHER_SPACE', 'target', 'move_to_same_desktop'],
    ['COMPUTER_CAPTURE_UNAVAILABLE', 'observation', 'wait_and_observe'],
    ['COMPUTER_CAPTURE_TARGET_MISMATCH', 'observation', 'reselect_window'],
    ['COMPUTER_BACKGROUND_INPUT_UNSUPPORTED', 'native', 'manual_input'],
    ['COMPUTER_INPUT_REFUSED', 'native', 'manual_input'],
    ['COMPUTER_LOCAL_UI_REQUIRED', 'permission', 'show_xopc_window'],
    ['COMPUTER_OS_PERMISSION_REQUIRED', 'permission', 'check_capture_permission'],
  ])('retains %s as a distinct failure with bounded recovery', (code, category, action) => {
    expect(classifyComputerFailure(new Error(code), 'open')).toMatchObject({ errorCode: code, category });
    expect(ComputerRecoverySchema.parse(computerRecoveryDirective(code))).toEqual({ action, automaticRetryAllowed: false });
    expect(computerRecovery(code)).not.toContain('Do not repeat the same call without a state change.');
  });

  it.each(['unknown', 'started'] as const)('never recommends automatic recovery for %s input', dispatch => {
    expect(computerRecoveryDirective('COMPUTER_CAPTURE_UNAVAILABLE', dispatch)).toEqual({ action: 'inspect_result', automaticRetryAllowed: false });
  });

  it('never infers unsupported background delivery from an arbitrary refusal or hint', () => {
    expect(computerNativeInputError({ errorCode: 'refused', text: 'background input unsupported' }, 'COMPUTER_INPUT_REFUSED').message).toBe('COMPUTER_INPUT_REFUSED');
    expect(computerNativeInputError({ error: { code: 'background_delivery_unsupported' } }, 'refused').message).toBe('COMPUTER_BACKGROUND_INPUT_UNSUPPORTED');
    expect(computerNativeInputError({ action: { error: { code: 'background_input_unsupported' } } }, 'refused').message).toBe('COMPUTER_BACKGROUND_INPUT_UNSUPPORTED');
  });
});
