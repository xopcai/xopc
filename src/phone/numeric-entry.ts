import type { PhoneAction, PhoneCompletion, PhoneElement, PhoneObservation } from './contracts.js';

export type PhoneNumericEntryIntent = { appPackage: string; targetDisplay: string; targetDigits: string };
export type PhoneNumericEntryStep = {
  action: Extract<PhoneAction, { type: 'tap' }>;
  appPackage: string;
  sourceFrameId: string;
  targetDisplay: string;
  displayBefore: string;
  expectedDisplay: string;
  controlResourceId: string;
  phase: 'digit' | 'erase';
};
export type PhoneNumericEntryDecision = { kind: 'action'; step: PhoneNumericEntryStep }
  | { kind: 'complete' }
  | { kind: 'blocked'; reason: 'keypad_unavailable' | 'fresh_observation_required' | 'unexpected_display' | 'invalid_previous_step' };

function durationParts(text: string): string[] | undefined {
  const match = /^(\d{2})h\s+(\d{2})m\s+(\d{2})s$/.exec(text);
  return match?.slice(1);
}

function digits(text: string): string | undefined {
  return durationParts(text)?.join('').replace(/^0+/, '');
}

function formatDigits(value: string): string {
  const padded = value.padStart(6, '0');
  return `${padded.slice(0, 2)}h ${padded.slice(2, 4)}m ${padded.slice(4, 6)}s`;
}

function visible(node: PhoneElement, screen: PhoneObservation): boolean {
  const [left, top, right, bottom] = node.bounds;
  return !node.password && node.bounds.every(Number.isFinite) && left >= 0 && top >= 0
    && right <= screen.width && bottom <= screen.height && right > left && bottom > top;
}

function uniqueNode(screen: PhoneObservation, resourceId: string, actionable = false): PhoneElement | undefined {
  const nodes = screen.elements.filter(node => node.resourceId === resourceId);
  if (nodes.length !== 1 || !visible(nodes[0], screen) || actionable && !nodes[0].clickable) return undefined;
  return nodes[0];
}

function readSetup(screen: PhoneObservation): { display: string; keys: PhoneElement[]; erase: PhoneElement } | undefined {
  const prefix = `${screen.package}:id/timer_setup_`;
  const display = uniqueNode(screen, `${prefix}time`);
  const erase = uniqueNode(screen, `${prefix}delete`, true);
  if (!display || !erase || digits(display.text) === undefined) return undefined;
  const keys: PhoneElement[] = [];
  for (let digit = 0; digit < 10; digit++) {
    const key = uniqueNode(screen, `${prefix}digit_${digit}`, true);
    if (!key || key.text !== String(digit) && key.description !== String(digit)) return undefined;
    keys.push(key);
  }
  for (const control of [...keys, erase]) {
    const [x, y] = [(control.bounds[0] + control.bounds[2]) / 2, (control.bounds[1] + control.bounds[3]) / 2];
    if (screen.elements.some(other => other !== control && (other.clickable || other.editable || other.password)
      && other.bounds[0] <= x && x < other.bounds[2] && other.bounds[1] <= y && y < other.bounds[3])) return undefined;
  }
  return { display: display.text, keys, erase };
}

function explicitTimerEntry(goal: string, target: string): boolean {
  // This closed command grammar intentionally falls back for all unrecognized language.
  if (/[?？]/.test(goal)) return false;
  const parts = durationParts(target)!;
  const canonical = `${parts[0]}h\\s+${parts[1]}m\\s+${parts[2]}s`;
  const units = ['(?:hours?|hrs?)', '(?:minutes?|mins?)', '(?:seconds?|secs?)'];
  const naturalParts = parts.flatMap((part, index) => Number(part) ? [`${Number(part)}\\s+${units[index]}`] : []);
  const natural = naturalParts.length ? naturalParts.join('\\s+(?:and\\s+)?') : '0\\s+(?:seconds?|secs?)';
  const value = `(?:${canonical}|\\(${canonical}\\)|${natural}\\s*\\(${canonical}\\))`;
  const timer = '(?:the\\s+|a\\s+)?(?:(?:stopped|unstarted)\\s+)?(?:timer|countdown)(?:\\s+in\\s+(?:the\\s+)?clock(?:\\s+app)?)?';
  const entryValue = `(?:(?:(?:a|the)\\s+)?(?:duration|time)(?:\\s+of)?\\s+)?(?:exactly\\s+)?${value}`;
  const noStartTail = '(?:\\s+without\\s+starting\\s+(?:the\\s+)?(?:timer|countdown|it))?';
  const englishCommand = new RegExp(`^(?:please\\s+)?(?:(?:set|configure)\\s+${timer}\\s+(?:(?:to|for)\\s+)?${entryValue}|open\\s+${timer}\\s+(?:and|then)\\s+(?:enter|set|configure)\\s+${entryValue}|enter\\s+${timer}\\s+(?:duration\\s+)?(?:of\\s+)?(?:exactly\\s+)?${value})${noStartTail}$`, 'i');
  const chineseCommand = new RegExp(`^(?:请)?(?:(?:设置|配置)(?:停止的|未启动的)?(?:计时器|倒计时)(?:为|到)?|(?:将|把)(?:停止的|未启动的)?(?:计时器|倒计时)(?:设置|配置)(?:为|到)|打开(?:计时器|倒计时)(?:并|然后)(?:输入|设置|配置)(?:为|到)?|(?:在|向)(?:计时器|倒计时)(?:中)?输入(?:时长)?)\\s*${canonical}$`, 'i');
  const safeConstraint = (part: string) => /^(?:do not|don't|must not|never)\s+(?:change\s+(?:any\s+|the\s+)?alarms?(?:\s+or\s+start\s+(?:the\s+)?(?:timer|countdown))?|start\s+(?:the\s+)?(?:timer|countdown)(?:\s+or\s+change\s+(?:any\s+|the\s+)?alarms?)?)$/i.test(part)
    || /^(?:keep|leave)\s+(?:the\s+)?alarms?\s+(?:unchanged|untouched|as[ -]is)$/i.test(part)
    || /^leave\s+(?:(?:that|the|this)\s+duration|it)\s+configured\s+without\s+starting\s+(?:the\s+)?(?:timer|countdown)$/i.test(part)
    || /^(?:(?:请)?(?:不要|勿|禁止|不许)(?:更改|修改|改变|设置)(?:任何|现有|已有)?闹钟(?:或(?:启动|开始)(?:计时器|倒计时))?|(?:请)?(?:不要|勿|禁止|不许)(?:启动|开始)(?:计时器|倒计时)|(?:保持|保留)(?:现有|原有|已有)?闹钟(?:不变|原样))$/.test(part);
  let commands = 0;
  for (const part of goal.split(/[.!;\n。！；,，]/).map(clause => clause.trim()).filter(Boolean)) {
    if (englishCommand.test(part) || chineseCommand.test(part)) commands++;
    else if (!safeConstraint(part)) return false;
  }
  return commands === 1;
}

/** Support the stopped Android Clock-style duration keypad only with explicit write intent. */
export function createPhoneNumericEntry(goal: string, completion: PhoneCompletion | undefined, screen: PhoneObservation): PhoneNumericEntryIntent | undefined {
  if (!completion?.textAll || completion.appPackage !== screen.package) return undefined;
  const targets = completion.textAll.filter(text => durationParts(text));
  if (targets.length !== 1) return undefined;
  const targetDisplay = targets[0];
  const parts = durationParts(targetDisplay)!;
  if (Number(parts[1]) > 59 || Number(parts[2]) > 59 || !explicitTimerEntry(goal, targetDisplay) || !readSetup(screen)) return undefined;
  return { appPackage: screen.package, targetDisplay, targetDigits: digits(targetDisplay)! };
}

/** An observed mismatch blocks further entry; a completed dispatch is not assumed to be a key press. */
export function nextPhoneNumericEntry(intent: PhoneNumericEntryIntent, screen: PhoneObservation, previousStep?: PhoneNumericEntryStep): PhoneNumericEntryDecision {
  if (previousStep) {
    if (previousStep.appPackage !== intent.appPackage || previousStep.targetDisplay !== intent.targetDisplay)
      return { kind: 'blocked', reason: 'invalid_previous_step' };
    if (previousStep.sourceFrameId === screen.frameId) return { kind: 'blocked', reason: 'fresh_observation_required' };
  }
  const setup = screen.package === intent.appPackage && readSetup(screen);
  if (!setup) return { kind: 'blocked', reason: 'keypad_unavailable' };
  if (previousStep && setup.display !== previousStep.expectedDisplay) return { kind: 'blocked', reason: 'unexpected_display' };
  if (setup.display === intent.targetDisplay) return { kind: 'complete' };
  const entered = digits(setup.display)!;
  const append = intent.targetDigits.startsWith(entered);
  const nextDigit = append ? intent.targetDigits[entered.length] : undefined;
  const control = append ? setup.keys[Number(nextDigit)] : setup.erase;
  if (!control) return { kind: 'blocked', reason: 'unexpected_display' };
  const expectedDigits = append ? entered + nextDigit : entered.slice(0, -1);
  return { kind: 'action', step: {
    action: { type: 'tap', point: [500 * (control.bounds[0] + control.bounds[2]) / screen.width,
      500 * (control.bounds[1] + control.bounds[3]) / screen.height] },
    appPackage: intent.appPackage, sourceFrameId: screen.frameId, targetDisplay: intent.targetDisplay,
    displayBefore: setup.display, expectedDisplay: formatDigits(expectedDigits), controlResourceId: control.resourceId,
    phase: append ? 'digit' : 'erase',
  } };
}
