import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { getApiKey, resolveModel } from '../../providers/index.js';
import { createPhoneModel, type PhonePrediction } from '../model-adapter.js';
import { guiPhonePrompt, parseDoubaoPhone, parseGuiOwlPhone } from '../gui-protocol.js';

vi.mock('../../providers/index.js', () => ({ resolveModel: vi.fn(), getApiKey: vi.fn(async () => 'byok-secret') }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const input: PhonePrediction = { goal: 'Search coffee', allowedApps: ['com.example.app'], applications: [{ packageName: 'com.example.app', label: 'Example' }],
  history: [], observation: { frameId: 'frame', capturedAt: 0, width: 1080, height: 2400, rotation: 0, package: 'com.example.app', frame: Buffer.from('image'), elements: [] } };
const seed = (name: string, params: Record<string, string> = {}) => `<seed:tool_call><function name="${name}">${Object.entries(params).map(([k, v]) => `<parameter name="${k}" string="true">${v}</parameter>`).join('')}</function></seed:tool_call>`;
const owl = (args: Record<string, unknown>, name = 'mobile_use') => `Action: Next step\n<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`;

describe('native phone GUI protocols', () => {
  it('keeps normalized points independent of screenshot resolution', () => {
    expect(parseDoubaoPhone(seed('click', { point: '<point>500 250</point>' }), input)).toEqual({ kind: 'action', action: { type: 'tap', point: [500, 250] } });
    expect(parseGuiOwlPhone(owl({ action: 'click', coordinate: [500, 250] }), input)).toEqual({ kind: 'action', action: { type: 'tap', point: [500, 250] } });
    expect(parseDoubaoPhone(seed('drag', { start_point: '<point>500 800</point>', end_point: '<point>500 200</point>' }), input)).toMatchObject({ action: { type: 'swipe', start: [500, 800], end: [500, 200] } });
    expect(parseGuiOwlPhone(owl({ action: 'swipe', coordinate: [500, 800], coordinate2: [500, 200] }), input)).toMatchObject({ action: { type: 'swipe', start: [500, 800], end: [500, 200] } });
  });
  it('preserves text and uses replacement semantics', () => {
    expect(parseDoubaoPhone(seed('type', { text: '咖啡 &amp; 茶 &lt;优惠&gt;' }), input)).toMatchObject({ action: { type: 'typeText', text: '咖啡 & 茶 <优惠>', mode: 'replace' } });
    expect(parseGuiOwlPhone(owl({ action: 'type', text: '咖啡\n茶' }), input)).toMatchObject({ action: { type: 'typeText', text: '咖啡\n茶', mode: 'replace' } });
  });
  it('resolves exact app labels and enforces the same app policy for both models', () => {
    expect(parseGuiOwlPhone(owl({ action: 'open', text: 'Example' }), input)).toMatchObject({ action: { type: 'launch', package: 'com.example.app' } });
    for (const parse of [() => parseDoubaoPhone(seed('open_app', { package: 'com.denied.app' }), input), () => parseGuiOwlPhone(owl({ action: 'open', text: 'com.denied.app' }), input)])
      expect(parse).toThrow(expect.objectContaining({ code: 'PHONE_APP_DENIED' }));
  });
  it('maps user assistance, unverified completion and bounded waits', () => {
    expect(parseDoubaoPhone('Found coffee', input)).toEqual({ kind: 'complete', summary: 'Found coffee' });
    expect(parseDoubaoPhone(seed('request_user', { reason: 'Please log in' }), input)).toEqual({ kind: 'needsUser', reason: 'Please log in' });
    expect(parseGuiOwlPhone(owl({ action: 'terminate', status: 'failure' }), input)).toMatchObject({ kind: 'needsUser' });
    expect(parseGuiOwlPhone(owl({ action: 'interact', text: 'Please log in' }), input)).toEqual({ kind: 'needsUser', reason: 'Please log in' });
    expect(parseDoubaoPhone(seed('wait', { seconds: '90' }), input)).toMatchObject({ action: { durationMs: 3000 } });
    expect(parseGuiOwlPhone(owl({ action: 'long_press', coordinate: [100, 200], time: 2 }), input)).toMatchObject({ action: { type: 'longPress', durationMs: 2000 } });
  });
  it.each([
    seed('click', { point: '<point>1001 20</point>' }), seed('click', { point: '<point>10 20</point>', extra: 'x' }),
    seed('click', { point: '<point>10 20</point>' }) + seed('hotkey', { key: 'HOME' }),
    '<seed:tool_call><function name="click"></function><function name="wait"></function></seed:tool_call>',
    '<seed:tool_call><function name="type"><parameter name="text">&evil;</parameter></function></seed:tool_call>',
    seed('hotkey', { key: 'rm -rf /' }), seed('type', { text: '<point>1 2</point>' }), seed('wait', { seconds: '-1' }),
    '<seed:tool_call>truncated', '<tool_call>wrong protocol</tool_call>',
  ])('rejects unsafe or malformed Seed responses: %s', raw => {
    expect(() => parseDoubaoPhone(raw, input)).toThrow(expect.objectContaining({ code: 'PHONE_MODEL_PROTOCOL' }));
  });
  it.each([
    owl({ action: 'click', coordinate: [10, 20] }) + owl({ action: 'type', text: 'send' }),
    owl({ action: 'key', text: 'power' }), owl({ action: 'system_button', button: 'Enter' }),
    owl({ action: 'click', coordinate: [-1, 20] }), owl({ action: 'click', coordinate: [10, 20], command: 'sh' }),
    owl({ action: 'click', coordinate: [10, 20] }, 'shell'), owl({ action: 'terminate', status: 'unknown' }),
    '<tool_call>{"name":"mobile_use","arguments":',
  ])('rejects unsafe or malformed Owl responses: %s', raw => {
    expect(() => parseGuiOwlPhone(raw, input)).toThrow(expect.objectContaining({ code: 'PHONE_MODEL_PROTOCOL' }));
  });
});

describe('BYOK native phone requests', () => {
  it.each(['doubao-seed-phone-v1', 'gui-owl-phone-v1'] as const)('uses %s through the configured provider without function-calling tools', async profile => {
    vi.mocked(resolveModel).mockReturnValue({ id: 'custom-deployment', provider: 'byok', baseUrl: 'https://byok.example/v1', api: 'openai-completions',
      input: ['text', 'image'], maxTokens: 4096, phoneUse: { profile } } as any);
    const action = profile === 'doubao-seed-phone-v1' ? seed('click', { point: '<point>100 200</point>' }) : owl({ action: 'click', coordinate: [100, 200] });
    const fetch = vi.fn(async () => Response.json({ choices: [{ message: { content: action }, finish_reason: 'stop' }] }));
    vi.stubGlobal('fetch', fetch);
    const adapter = await createPhoneModel('byok/custom-deployment', ConfigSchema.parse({}), 'main');
    expect(await adapter.predict(input, new AbortController().signal)).toMatchObject({ action: { point: [100, 200] } });
    expect(getApiKey).toHaveBeenCalledWith('byok', expect.objectContaining({ agentId: 'main' }));
    const [url, options] = (fetch.mock.calls as unknown as [URL, RequestInit][])[0];
    expect(String(url)).toBe('https://byok.example/v1/chat/completions');
    expect(options.headers).toMatchObject({ Authorization: 'Bearer byok-secret' });
    const body = JSON.parse(options.body as string);
    expect(body).toMatchObject({ model: 'custom-deployment', stream: false });
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].content).toContain(guiPhonePrompt(profile));
    await expect(adapter.readScreen!(input, new AbortController().signal)).rejects.toMatchObject({ code: 'PHONE_SCREEN_UNREADABLE' });
  });
  it.each(['doubao-seed-phone-v1', 'gui-owl-phone-v1'] as const)('reads screenshots and rejects truncated actions for %s', async profile => {
    vi.mocked(resolveModel).mockReturnValue({ id: 'phone', provider: 'byok', baseUrl: 'https://byok.example/v1', api: 'openai-completions', input: ['image'], phoneUse: { profile } } as any);
    const content = profile === 'doubao-seed-phone-v1' ? 'Android 15' : owl({ action: 'answer', text: 'Android 15' });
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content }, finish_reason: 'length' }] }));
    vi.stubGlobal('fetch', fetch);
    const adapter = await createPhoneModel('byok/phone', ConfigSchema.parse({}), 'main');
    expect(await adapter.readScreen!(input, new AbortController().signal)).toBe('Android 15');
    await expect(adapter.predict(input, new AbortController().signal)).rejects.toMatchObject({ code: 'PHONE_MODEL_TRUNCATED' });
  });
});
