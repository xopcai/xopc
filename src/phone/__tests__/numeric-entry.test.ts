import { describe, expect, it } from 'vitest';

import type { PhoneCompletion, PhoneElement, PhoneObservation } from '../contracts.js';
import { createPhoneNumericEntry, nextPhoneNumericEntry, type PhoneNumericEntryStep } from '../numeric-entry.js';

const APP = 'com.example.clock';
function node(id: string, text: string, index = 0): PhoneElement {
  return { resourceId: `${APP}:id/timer_setup_${id}`, text, description: '', clickable: true, focused: false,
    password: false, bounds: [100 + index * 60, 400, 150 + index * 60, 450] };
}
function screen(display = '00h 00m 00s', frameId = 'initial'): PhoneObservation {
  return { package: APP, frameId, capturedAt: 0, width: 1000, height: 2000, rotation: 0, frame: Buffer.alloc(0),
    elements: [{ ...node('time', display), clickable: false }, node('delete', 'Backspace', 10),
      ...Array.from({ length: 10 }, (_, index) => node(`digit_${index}`, String(index), index))] };
}
const completion = (target = '00h 02m 30s'): PhoneCompletion => ({ appPackage: APP, textAll: [target] });
const goal = (target = '00h 02m 30s') => `Open Timer and enter the duration ${target}. Do not change alarms or start the timer.`;
function actionStep(result: ReturnType<typeof nextPhoneNumericEntry>): PhoneNumericEntryStep {
  expect(result.kind).toBe('action');
  if (result.kind !== 'action') throw new Error('Expected a keypad action');
  return result.step;
}

describe('native duration entry controller', () => {
  it('enters successive digits only after fresh exact native feedback, without starting', () => {
    const initial = screen();
    const intent = createPhoneNumericEntry(goal(), completion(), initial)!;
    const first = actionStep(nextPhoneNumericEntry(intent, initial));
    expect(first).toMatchObject({ phase: 'digit', controlResourceId: `${APP}:id/timer_setup_digit_2`, expectedDisplay: '00h 00m 02s' });
    const second = actionStep(nextPhoneNumericEntry(intent, screen(first.expectedDisplay, 'two'), first));
    expect(second).toMatchObject({ controlResourceId: `${APP}:id/timer_setup_digit_3`, expectedDisplay: '00h 00m 23s' });
    const third = actionStep(nextPhoneNumericEntry(intent, screen(second.expectedDisplay, 'three'), second));
    expect(third).toMatchObject({ controlResourceId: `${APP}:id/timer_setup_digit_0`, expectedDisplay: '00h 02m 30s' });
    expect(nextPhoneNumericEntry(intent, screen(third.expectedDisplay, 'four'), third)).toEqual({ kind: 'complete' });
    expect([first, second, third].every(step => step.action.type === 'tap' && !step.controlResourceId.endsWith('fab'))).toBe(true);
  });

  it('supports another duration and another Clock-compatible package without a task template', () => {
    const target = '01h 05m 09s';
    const intent = createPhoneNumericEntry(goal(target), completion(target), screen())!;
    let observation = screen(); let previous: PhoneNumericEntryStep | undefined;
    const controls: string[] = [];
    for (let count = 0; count < 7; count++) {
      const next = nextPhoneNumericEntry(intent, observation, previous);
      if (next.kind === 'complete') break;
      previous = actionStep(next); controls.push(previous.controlResourceId.split('_').at(-1)!);
      observation = screen(previous.expectedDisplay, String(count));
    }
    expect(controls).toEqual(['1', '0', '5', '0', '9']);
    expect(observation.elements[0].text).toBe(target);
  });

  it('erases a non-prefix one key at a time and verifies each resulting state', () => {
    const intent = createPhoneNumericEntry(goal(), completion(), screen('00h 22m 23s'))!;
    const erase = actionStep(nextPhoneNumericEntry(intent, screen('00h 22m 23s')));
    expect(erase).toMatchObject({ phase: 'erase', expectedDisplay: '00h 02m 22s', controlResourceId: `${APP}:id/timer_setup_delete` });
    const next = actionStep(nextPhoneNumericEntry(intent, screen(erase.expectedDisplay, 'new'), erase));
    expect(next).toMatchObject({ phase: 'erase', expectedDisplay: '00h 00m 22s' });
  });

  it('blocks on missing, wrong or reused feedback instead of repeating input', () => {
    const initial = screen(); const intent = createPhoneNumericEntry(goal(), completion(), initial)!;
    const step = actionStep(nextPhoneNumericEntry(intent, initial));
    expect(nextPhoneNumericEntry(intent, initial, step)).toEqual({ kind: 'blocked', reason: 'fresh_observation_required' });
    expect(nextPhoneNumericEntry(intent, screen('00h 00m 00s', 'new'), step)).toEqual({ kind: 'blocked', reason: 'unexpected_display' });
    expect(nextPhoneNumericEntry(intent, screen('00h 00m 03s', 'new'), step)).toEqual({ kind: 'blocked', reason: 'unexpected_display' });
    expect(nextPhoneNumericEntry(intent, screen(step.expectedDisplay, 'new'), { ...step, targetDisplay: '00h 00m 40s' }))
      .toEqual({ kind: 'blocked', reason: 'invalid_previous_step' });
  });

  it.each([
    'Inspect the timer showing 00h 02m 30s without changing it.',
    'Do not enter 00h 02m 30s in the timer.',
    "Don't set the timer to 00h 02m 30s.",
    '禁止设置计时器为 00h 02m 30s。',
    'Enter 00h 02m 30s into a calculator.',
    'Set the timer to 00h 00m 40s.',
    'The Timer is open. Enter 00h 02m 30s into a calculator.',
    'The timer shows 00h 02m 30s, then enter a name elsewhere.',
    'Set the timer to 00h 02m 30s or 00h 00m 40s.',
    'If the meeting ends, set the timer to 00h 02m 30s.',
    'Explain how to configure the timer to 00h 02m 30s without changing it.',
    'Describe the steps. Configure the timer to 00h 02m 30s.',
    'Please explain: Configure the timer to 00h 02m 30s.',
    'The instructions say: Set the timer to 00h 02m 30s.',
    'A user would configure the timer to 00h 02m 30s.',
    'The timer should be set to 00h 02m 30s.',
    'Configure the timer to 00h 02m 30s only as a hypothetical example.',
    'Configure the timer to 00h 02m 30s without changing it.',
    'Configure the timer to 00h 02m 30s. Do not actually operate the phone.',
    'Configure the timer to 00h 02m 30s. Keep it unchanged.',
    "Configure the timer to 00h 02m 30s, but don't press anything.",
    'Configure the timer to 00h 02m 30s. No actual operation.',
    'Configure the timer to 00h 02m 30s without actually configuring it.',
    'Configure the timer to 00h 02m 30s. This is read-only.',
    'Set the timer to 00h 02m 30s. Do not change alarms or operate the timer.',
    'Explain the sentence "Configure the timer to 00h 02m 30s".',
    '"Set the timer to 00h 02m 30s"',
    "'Set the timer to 00h 02m 30s'",
    '请解释设置计时器为 00h 02m 30s 这句话，不要实际操作。',
    '设置计时器为 00h 02m 30s，但不要实际操作。',
    '设置计时器为 00h 02m 30s。保持原样。',
    '解释以下内容。配置计时器为 00h 02m 30s。',
    '“设置计时器为 00h 02m 30s”',
    'Set the timer to 00h 02m 30s; refrain from making any changes.',
    'Set the timer to 00h 02m 30s, but make zero changes.',
    'Set the timer to 00h 02m 30s as a reference.',
    'Set the timer as a reference to 00h 02m 30s.',
    'Set the timer name to 00h 02m 30s.',
    'The command is. Set the timer to 00h 02m 30s.',
    'I want to know. Set the timer to 00h 02m 30s.',
    'Set the timer to 00h 02m 30s. I only want its meaning.',
    'Set the timer to 00h 02m 30s. Set the timer to 00h 00m 40s.',
    'Set the timer to 00h 02m 30s. Set the timer to 00h 02m 30s.',
    'Open Timer in Clock and enter a duration of exactly 5 minutes (00h 02m 30s).',
    'Open Timer in Clock and enter a duration of exactly 2 minutes 31 seconds (00h 02m 30s).',
    'Set the timer when the meeting ends to 00h 02m 30s.',
    'Set the timer to 00h 02m 30s?',
    '设置计时器为 00h 02m 30s。请只理解这句话。',
    '先保持原状。设置计时器为 00h 02m 30s。',
    '设置计时器为 00h 02m 30s。设置计时器为 00h 00m 40s。',
  ])('requires explicit matching timer-write intent: %s', text => {
    expect(createPhoneNumericEntry(text, completion(), screen())).toBeUndefined();
  });

  it('accepts Chinese explicit entry and preserves unrelated negative constraints', () => {
    expect(createPhoneNumericEntry('设置计时器为 00h 02m 30s，不要更改闹钟。', completion(), screen())).toBeDefined();
    expect(createPhoneNumericEntry(goal(), completion(), screen())).toBeDefined();
    const goals = [
      'Open Timer in Clock and enter a duration of exactly 2 minutes 30 seconds (00h 02m 30s). Leave the duration configured without starting the timer. Do not change alarms.',
      'Configure the stopped Timer in Clock to exactly 00h 02m 30s. Leave that duration configured without starting the timer. Do not change alarms.',
      'Please set the timer to 00h 02m 30s. Keep alarms unchanged.',
      "Set the timer to 00h 02m 30s. Don't start the timer.",
      'Set the timer to 00h 02m 30s without starting it.',
      'Do not change alarms. Set the timer to 00h 02m 30s.',
      '请将计时器设置为 00h 02m 30s，不要更改闹钟。',
    ];
    for (const text of goals) expect(createPhoneNumericEntry(text, completion(), screen())).toBeDefined();
    for (const target of ['00h 08m 45s', '01h 05m 09s']) {
      const text = `Configure the stopped Timer in Clock to exactly ${target}. Leave that duration configured without starting the timer. Do not change alarms.`;
      expect(createPhoneNumericEntry(text, completion(target), screen())).toBeDefined();
    }
  });

  it('requires the complete unique visible non-password actionable stopped keypad', () => {
    const variants = [screen(), screen(), screen(), screen(), screen()];
    variants[0].elements = variants[0].elements.filter(element => !element.resourceId.endsWith('digit_9'));
    variants[1].elements[2].password = true;
    variants[2].elements[2].bounds[0] = -10;
    variants[3].elements[2].clickable = false;
    variants[4].elements.push({ ...variants[4].elements[2] });
    for (const variant of variants) expect(createPhoneNumericEntry(goal(), completion(), variant)).toBeUndefined();
    const running = screen(); running.elements = [node('time', '00h 02m 30s')];
    expect(createPhoneNumericEntry(goal(), completion(), running)).toBeUndefined();
  });

  it('blocks if the native keypad disappears or foreground package changes after entry', () => {
    const initial = screen(); const intent = createPhoneNumericEntry(goal(), completion(), initial)!;
    const step = actionStep(nextPhoneNumericEntry(intent, initial));
    const changed = screen(step.expectedDisplay, 'new'); changed.package = 'com.other.app';
    expect(nextPhoneNumericEntry(intent, changed, step)).toEqual({ kind: 'blocked', reason: 'keypad_unavailable' });
    const missing = screen(step.expectedDisplay, 'new'); missing.elements.pop();
    expect(nextPhoneNumericEntry(intent, missing, step)).toEqual({ kind: 'blocked', reason: 'keypad_unavailable' });
  });

  it('refuses ambiguous overlay or password hit targets even when all keypad labels remain present', () => {
    for (const password of [false, true]) {
      const observation = screen();
      observation.elements.push({ ...node('overlay', ''), bounds: [...observation.elements[2].bounds], password,
        clickable: !password, resourceId: 'other:id/overlay' });
      expect(createPhoneNumericEntry(goal(), completion(), observation)).toBeUndefined();
    }
  });

  it('rejects ambiguous completion targets, invalid minute/second values and wrong app bindings', () => {
    expect(createPhoneNumericEntry(goal(), { ...completion(), textAll: ['00h 02m 30s', '00h 00m 40s'] }, screen())).toBeUndefined();
    expect(createPhoneNumericEntry(goal('00h 99m 00s'), completion('00h 99m 00s'), screen())).toBeUndefined();
    expect(createPhoneNumericEntry(goal(), { ...completion(), appPackage: 'com.other.app' }, screen())).toBeUndefined();
    expect(createPhoneNumericEntry(goal(), undefined, screen())).toBeUndefined();
    expect(createPhoneNumericEntry(goal(), { textAll: ['00h 02m 30s'] }, screen())).toBeUndefined();
  });
});
