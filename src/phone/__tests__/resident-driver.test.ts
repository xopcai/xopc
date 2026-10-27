import { expect, it, vi } from 'vitest';

import { AdbPhoneDriver } from '../adb-driver.js';
import type { PhoneObservation } from '../contracts.js';
import { PhoneUiSession } from '../ui-session.js';

const signal = () => new AbortController().signal;
const screen = (): PhoneObservation => ({ frameId: 'frame', capturedAt: Date.now(), width: 720, height: 1280, rotation: 0,
  package: 'com.test.app', frame: Buffer.from('pixels'), elements: [{ text: 'old', description: '', resourceId: 'query',
    focused: true, editable: true, password: false, clickable: true, bounds: [0, 0, 200, 100] }] });
function observer() {
  const session = new PhoneUiSession({ readable: { async *[Symbol.asyncIterator]() {} }, write: async () => {}, close: async () => {} });
  const close = vi.spyOn(session, 'close').mockResolvedValue();
  const snapshot = vi.spyOn(session, 'snapshot').mockResolvedValue('<hierarchy><node package="com.test.app" class="android.widget.EditText" resource-id="query" focused="true" text="old" bounds="[0,0][200,100]"/></hierarchy>');
  const replace = vi.spyOn(session, 'replace').mockResolvedValue();
  return { session, close, snapshot, replace };
}

it('reuses one observer for fresh hierarchies and guarded replacement, with no clipboard fallback', async () => {
  const f = observer(); const create = vi.fn(async () => f.session); const command = vi.fn(); const paste = vi.fn();
  const driver = new AdbPhoneDriver('adb', command, false, undefined, paste, undefined, undefined, create);
  const capture = vi.spyOn(driver, 'capture').mockImplementation(async () => screen());
  const first = await driver.observe('phone', signal()); const second = await driver.observe('phone', signal());
  await driver.execute('phone', { type: 'typeText', mode: 'replace', text: '咖啡😀' }, second, signal(), { settleMs: 0 });
  expect(create).toHaveBeenCalledOnce(); expect(f.snapshot).toHaveBeenCalledTimes(2); expect(capture).toHaveBeenCalledTimes(2);
  expect(f.replace).toHaveBeenCalledWith('com.test.app', second.elements[0], '咖啡😀', expect.any(AbortSignal));
  expect(command).not.toHaveBeenCalled(); expect(paste).not.toHaveBeenCalled();
  first.frame.fill(0); second.frame.fill(0); await driver.releaseInput(); expect(f.close).toHaveBeenCalledOnce();
});

it('does not fall back or replay when native replacement confirmation is lost', async () => {
  const f = observer(); f.replace.mockRejectedValue(Object.assign(new Error('lost response'), { code: 'PHONE_TEXT_INPUT_UNCONFIRMED' }));
  const command = vi.fn(); const paste = vi.fn();
  const driver = new AdbPhoneDriver('adb', command, false, undefined, paste, undefined, undefined, async () => f.session);
  await expect(driver.execute('phone', { type: 'typeText', mode: 'replace', text: 'new' }, screen(), signal(), { settleMs: 0 }))
    .rejects.toMatchObject({ code: 'PHONE_TEXT_INPUT_UNCONFIRMED' });
  expect(f.replace).toHaveBeenCalledOnce(); expect(command).not.toHaveBeenCalled(); expect(paste).not.toHaveBeenCalled();
  await driver.releaseInput();
});

it('closes an observer that finishes opening after operation cleanup begins', async () => {
  const f = observer(); let complete!: (value: PhoneUiSession) => void;
  const opening = new Promise<PhoneUiSession>(resolve => { complete = resolve; });
  const driver = new AdbPhoneDriver('adb', vi.fn(), false, undefined, undefined, undefined, undefined, () => opening);
  const observed = expect(driver.observe('phone', signal())).rejects.toMatchObject({ code: 'PHONE_CANCELLED' });
  const cleanup = driver.releaseInput(); complete(f.session); await cleanup; await observed;
  expect(f.close).toHaveBeenCalledOnce(); expect(f.snapshot).not.toHaveBeenCalled();
});

it('rejects truncated current values and password fields before a native write', async () => {
  const f = observer(); const driver = new AdbPhoneDriver('adb', vi.fn(), false, undefined, undefined, undefined, undefined, async () => f.session);
  for (const target of [{ ...screen().elements[0], password: true }, { ...screen().elements[0], text: 'x'.repeat(500) }]) {
    await expect(driver.execute('phone', { type: 'typeText', mode: 'replace', text: 'new' }, { ...screen(), elements: [target] }, signal(), { settleMs: 0 })).rejects.toThrow();
  }
  expect(f.replace).not.toHaveBeenCalled(); await driver.releaseInput();
});

it('decodes XML field text exactly once, including literal entity-looking content', async () => {
  const { parsePhoneUi } = await import('../adb-driver.js');
  const [field] = parsePhoneUi('<hierarchy><node class="android.widget.EditText" text="A&amp;B &lt;C&gt; &quot;D&quot; &amp;lt; 😀" content-desc="X&amp;Y" bounds="[0,0][100,100]"/></hierarchy>');
  expect(field.text).toBe('A&B <C> "D" &lt; 😀'); expect(field.description).toBe('X&Y');
});
