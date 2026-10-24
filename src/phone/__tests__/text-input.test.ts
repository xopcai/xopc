import { afterEach, expect, it, vi } from 'vitest';
import { AdbPhoneDriver } from '../adb-driver.js';
import { ScrcpyTextChannel } from '../scrcpy-text.js';
import type { PhoneObservation } from '../contracts.js';

const ack = (seq = 1n) => { const bytes = Buffer.alloc(9); bytes[0] = 1; bytes.writeBigUInt64BE(seq, 1); return bytes; };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it('frames Unicode as data, waits for a split matching ACK and never requests clipboard reads', async () => {
  const writes: Buffer[] = []; const channel = new ScrcpyTextChannel(async bytes => { writes.push(Buffer.from(bytes)); });
  let done = false; const pending = channel.paste('高德地图😀\n%$(`test`)', new AbortController().signal).then(() => { done = true; });
  expect(writes[0][0]).toBe(9); expect(writes[0][9]).toBe(1);
  expect(writes[0].subarray(14).toString()).toBe('高德地图😀\n%$(`test`)');
  channel.receive(ack(99n)); await Promise.resolve(); expect(done).toBe(false);
  channel.receive(ack().subarray(0, 4)); await Promise.resolve(); expect(done).toBe(false);
  channel.receive(ack().subarray(4)); await pending; expect(done).toBe(true);
  expect(writes).toHaveLength(1); channel.close();
});
it('never retries a paste on lost acknowledgement, cancellation or disconnect', async () => {
  vi.useFakeTimers();
  const write = vi.fn(async () => {}); const channel = new ScrcpyTextChannel(write);
  const pending = expect(channel.paste('中文', new AbortController().signal)).rejects.toMatchObject({code:'PHONE_TEXT_INPUT_UNCONFIRMED'});
  channel.close(); await pending; expect(write).toHaveBeenCalledOnce();
  const aborted = new AbortController(); aborted.abort();
  await expect(channel.paste('中文', aborted.signal)).rejects.toThrow(); expect(write).toHaveBeenCalledOnce();
});
it('bounds inbound clipboard messages without interpreting or emitting their contents', () => {
  const channel = new ScrcpyTextChannel(async () => {}); const packet = Buffer.alloc(5); packet.writeUInt32BE(262145, 1);
  expect(() => channel.receive(packet)).toThrow('Invalid device message'); channel.close();
});
function fixture() {
  const command = vi.fn(async (_path: string, _args: string[], _signal?: AbortSignal) => Buffer.alloc(0)); const paste = vi.fn(async () => {});
  const driver = new AdbPhoneDriver('adb', command, false, undefined, paste);
  vi.spyOn(driver, 'textInputStatus').mockResolvedValue({ androidSdk: 31, unicode: 'available', method: 'scrcpy-clipboard', keyboardRequired: false });
  const observation: PhoneObservation = { frameId:'test', capturedAt:Date.now(), width:720, height:1280, rotation:0, package:'com.app.store', frame:Buffer.alloc(0), elements:[{text:'',description:'',resourceId:'input',focused:true,password:false,editable:true,clickable:true,bounds:[0,0,200,100]}] };
  const after = { ...observation, frame:Buffer.from('pixels'), elements:[{...observation.elements[0],text:'高德地图'}] };
  vi.spyOn(driver,'observe').mockResolvedValue(after);
  return { driver, command, paste, observation, after };
}
it('pastes and verifies Chinese with no keyboard install, IME change or shell interpolation', async () => {
  const f=fixture(); await f.driver.execute('phone',{type:'typeText',text:'高德地图'},f.observation,new AbortController().signal,{settleMs:0});
  expect(f.paste).toHaveBeenCalledWith('高德地图',expect.any(AbortSignal)); expect(f.command).not.toHaveBeenCalled();
  expect(f.after.frame.every(b=>b===0)).toBe(true);
});
it('keeps passwords unfocused fields and missing capabilities from emitting text', async () => {
  const f=fixture();
  for(const elements of [[],[{...f.observation.elements[0],password:true}]])
    await expect(f.driver.execute('phone',{type:'typeText',text:'高德地图'},{...f.observation,elements},new AbortController().signal)).rejects.toMatchObject({code:'PHONE_INPUT_NOT_FOCUSED'});
  vi.mocked(f.driver.textInputStatus).mockResolvedValue({androidSdk:23,unicode:'unsupported',method:'scrcpy-clipboard',keyboardRequired:false});
  await expect(f.driver.execute('phone',{type:'typeText',text:'高德地图'},f.observation,new AbortController().signal)).rejects.toMatchObject({code:'PHONE_TEXT_INPUT_UNAVAILABLE'});
  expect(f.paste).not.toHaveBeenCalled();
});
it('does not mistake clipboard receipt for successful app insertion or paste twice', async () => {
  const f=fixture(); f.after.elements[0].text='';
  await expect(f.driver.execute('phone',{type:'typeText',text:'高德地图'},f.observation,new AbortController().signal,{settleMs:0})).rejects.toMatchObject({code:'PHONE_TEXT_INPUT_UNCONFIRMED'});
  expect(f.paste).toHaveBeenCalledOnce(); expect(f.after.frame.every(b=>b===0)).toBe(true);
});
it('replaces an existing query through selection and verifies the exact result without changing input methods', async () => {
  const f = fixture(); f.observation.elements[0].text = '火锅';
  f.command.mockResolvedValue(Buffer.from('keycombination <key code 1> <key code 2>'));
  const observation = (text: string) => ({ ...f.observation, frame: Buffer.from('pixels'), elements: [{ ...f.observation.elements[0], text }] });
  vi.mocked(f.driver.observe).mockResolvedValueOnce(observation('火锅')).mockResolvedValueOnce(observation('火锅'))
    .mockResolvedValueOnce(observation('咖啡'));
  await f.driver.execute('phone', { type: 'typeText', text: '咖啡', mode: 'replace' }, f.observation, new AbortController().signal, { settleMs: 0 });
  expect(f.command.mock.calls.map(call => call[1])).toEqual([
    ['-s', 'phone', 'shell', 'input'],
    ['-s', 'phone', 'shell', 'input', 'keycombination', 'KEYCODE_CTRL_LEFT', 'KEYCODE_A'],
  ]);
  expect(f.paste).toHaveBeenCalledOnce(); expect(f.paste).toHaveBeenCalledWith('咖啡', expect.any(AbortSignal));
});
it('refuses replacement when select-all is unavailable before clearing or pasting', async () => {
  const f = fixture(); f.observation.elements[0].text = 'old'; f.after.elements[0].text = 'old';
  await expect(f.driver.execute('phone', { type: 'typeText', text: 'new', mode: 'replace' }, f.observation, new AbortController().signal))
    .rejects.toMatchObject({ code: 'PHONE_TEXT_INPUT_UNAVAILABLE' });
  expect(f.command).toHaveBeenCalledOnce(); expect(f.paste).not.toHaveBeenCalled();
});
it('stops replacement when the focused editor changes before destructive input', async () => {
  const f = fixture(); f.after.elements[0].resourceId = 'other-input';
  await expect(f.driver.execute('phone', { type: 'typeText', text: 'new', mode: 'replace' }, f.observation, new AbortController().signal))
    .rejects.toMatchObject({ code: 'PHONE_INPUT_NOT_FOCUSED' });
  expect(f.command).not.toHaveBeenCalled(); expect(f.paste).not.toHaveBeenCalled();
});
it('polls delayed ASCII insertion without sending the text again', async () => {
  const f = fixture();
  vi.mocked(f.driver.observe).mockResolvedValueOnce({ ...f.after, elements: [{ ...f.after.elements[0], text: '' }] })
    .mockResolvedValueOnce({ ...f.after, elements: [{ ...f.after.elements[0], text: 'coffee' }] });
  await f.driver.execute('phone', { type: 'typeText', text: 'coffee' }, f.observation, new AbortController().signal, { settleMs: 0 });
  expect(f.command).toHaveBeenCalledOnce(); expect(f.paste).not.toHaveBeenCalled();
  expect(f.driver.observe).toHaveBeenCalledTimes(2);
});
it('requires an exact replacement result and never retries the input', async () => {
  const f = fixture();
  vi.mocked(f.driver.observe).mockResolvedValueOnce({ ...f.observation, frame: Buffer.from('fresh') })
    .mockResolvedValue({ ...f.after, elements: [{ ...f.after.elements[0], text: 'old高德地图' }] });
  await expect(f.driver.execute('phone', { type: 'typeText', text: '高德地图', mode: 'replace' }, f.observation, new AbortController().signal, { settleMs: 0 }))
    .rejects.toMatchObject({ code: 'PHONE_TEXT_INPUT_UNCONFIRMED' });
  expect(f.paste).toHaveBeenCalledOnce();
});
it('does not verify text from another editor', async () => {
  const f = fixture();
  f.after.elements[0] = { ...f.observation.elements[0], resourceId: 'other', text: '高德地图' };
  await expect(f.driver.execute('phone', { type: 'typeText', text: '高德地图' }, f.observation, new AbortController().signal, { settleMs: 0 }))
    .rejects.toMatchObject({ code: 'PHONE_TEXT_INPUT_UNCONFIRMED' });
  expect(f.paste).toHaveBeenCalledOnce();
});
it('never repeats an ASCII replacement when selection did not take effect', async () => {
  const f = fixture(); f.observation.elements[0].text = 'old'; f.after.elements[0].text = 'old';
  f.command.mockResolvedValue(Buffer.from('keycombination'));
  vi.mocked(f.driver.observe).mockResolvedValueOnce({ ...f.observation, frame: Buffer.from('before') })
    .mockResolvedValueOnce({ ...f.observation, frame: Buffer.from('selected') })
    .mockResolvedValue({ ...f.after, elements: [{ ...f.after.elements[0], text: 'oldnew' }] });
  await expect(f.driver.execute('phone', { type: 'typeText', text: 'new', mode: 'replace' }, f.observation, new AbortController().signal))
    .rejects.toMatchObject({ code: 'PHONE_TEXT_INPUT_UNCONFIRMED' });
  expect(f.command.mock.calls.map(call => call[1]?.at(-1))).toEqual(['input', 'KEYCODE_A', 'new']);
  expect(f.paste).not.toHaveBeenCalled();
});
it('checks Unicode capability before clearing existing text', async () => {
  const f = fixture(); f.observation.elements[0].text = 'old';
  vi.mocked(f.driver.textInputStatus).mockResolvedValue({ androidSdk: 23, unicode: 'unsupported', method: 'scrcpy-clipboard', keyboardRequired: false });
  await expect(f.driver.execute('phone', { type: 'typeText', text: '咖啡', mode: 'replace' }, f.observation, new AbortController().signal))
    .rejects.toMatchObject({ code: 'PHONE_TEXT_INPUT_UNAVAILABLE' });
  expect(f.command).not.toHaveBeenCalled(); expect(f.paste).not.toHaveBeenCalled();
});
