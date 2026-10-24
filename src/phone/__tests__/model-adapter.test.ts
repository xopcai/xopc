import { afterEach, describe, expect, it, vi } from 'vitest';

import { withCloudCreditBudget, cloudCreditBudgetStopMessage } from '../../providers/xopc-cloud-credit-budget.js';
import { XopcCloudAccountService } from '../../providers/xopc-cloud-account-service.js';
import { resolveModel, getApiKey } from '../../providers/index.js';
import type { Config } from '../../config/schema.js';
import type { PhoneElement } from '../contracts.js';
import { buildPhoneModelContext, createPhoneModel, parseAutoGlmResponse, type PhonePrediction } from '../model-adapter.js';

vi.mock('../../providers/index.js', () => ({
  resolveModel: vi.fn(() => ({ id: 'autoglm', provider: 'test', api: 'openai-completions', input: ['image'],
    baseUrl: 'https://phone.example/v1', phoneUse: { profile: 'autoglm-phone-v1' }, maxTokens: 4000 })),
  getApiKey: vi.fn(async () => 'test-key'),
}));

afterEach(() => vi.unstubAllGlobals());

function prediction(): PhonePrediction {
  return { goal: 'Search for coffee', allowedApps: ['com.example.app'], history: ['tap', 'typeText'],
    observation: { frameId: 'one', capturedAt: Date.now(), width: 1000, height: 2000, rotation: 0,
      package: 'com.example.app', frame: Buffer.from('pixels'), elements: [] } };
}
function element(overrides: Partial<PhoneElement> = {}): PhoneElement {
  return { text: 'Search', description: '', resourceId: 'app:id/search', clickable: true, focused: false,
    editable: false, password: false, bounds: [100, 200, 500, 400], ...overrides };
}

describe('phone model context and protocol', () => {
  it('preserves attempted targets and queries in bounded context while excluding password nodes', () => {
    const input = prediction();
    input.observation.elements = [element({ text: 'secret-password', description: 'secret-description', resourceId: 'secret-id', password: true }),
      ...Array.from({ length: 45 }, (_, i) => element({ text: `row-${i}` })),
      element({ text: 'coffee', editable: true, focused: true })];
    input.trajectory = Array.from({ length: 12 }, (_, i) => ({ action: { type: 'typeText' as const, text: `query-${i}`, mode: 'replace' as const },
      dispatch: 'completed' as const, beforeApp: 'com.example.app', effect: 'changed' as const, facts: ['No results'] }));
    input.recoveryHint = 'Search returned no results; revise query without loosening constraints';
    input.progressSummary = 'x'.repeat(2000);
    const context = buildPhoneModelContext(input);
    expect(context.ui).toHaveLength(40);
    expect(context.ui[0]).toMatchObject({ text: 'coffee', focused: true, bounds: [100, 100, 500, 200] });
    expect(JSON.stringify(context)).not.toContain('secret-');
    expect(context.trajectory).toHaveLength(8);
    expect(context.trajectory?.[0]).toMatchObject({ action: { text: 'query-4', mode: 'replace' }, facts: ['No results'] });
    expect(context.recoveryHint).toContain('revise query');
    expect(context.progressSummary).toHaveLength(1500);
    expect(JSON.stringify(context)).not.toContain('pixels');
  });

  it.each(['Type', 'Type_Name'])('uses replacement semantics for AutoGLM %s', action => {
    expect(parseAutoGlmResponse(`do(action="${action}", text="coffee")`, [])).toEqual({ kind: 'action',
      action: { type: 'typeText', text: 'coffee', mode: 'replace' } });
  });

  it.each([
    ['do(action="Wait", duration="2.5 seconds")', 2500],
    ['do(action="Wait", duration=2)', 2000],
    ['do(action="Wait", duration="90 seconds")', 3000],
    ['do(action="Wait", duration="0.01 s")', 100],
    ['do(action="Wait")', 1000],
  ])('honors a bounded wait: %s', (raw, durationMs) => {
    expect(parseAutoGlmResponse(raw, [])).toEqual({ kind: 'action', action: { type: 'wait', durationMs } });
  });

  it.each(['-1 seconds', '0 seconds', 'NaN', '1 minute', '1 seconds; do(action="Home")'])('refuses invalid waits: %s', duration => {
    expect(() => parseAutoGlmResponse(`do(action="Wait", duration='${duration}')`, [])).toThrow('Invalid AutoGLM');
  });

  it('sends recovery context and the current image in one request without hidden retries', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ choices: [{ message: { content: 'do(action="Back")' }, finish_reason: 'stop' }] }));
    vi.stubGlobal('fetch', fetch);
    const adapter = await createPhoneModel('test/autoglm', {} as Config, 'main');
    const input = prediction(); input.protocolFeedback = 'Previous decision was invalid; return one valid action';
    input.observation.elements = [element()];
    input.completion = { appPackage: 'com.example.app', textAll: ['Android version'] };
    expect(await adapter.predict(input, new AbortController().signal)).toEqual({ kind: 'action', action: { type: 'back' } });
    expect(fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(body.max_tokens).toBe(3000);
    expect(body.messages[0].content).toContain('Never repeat a dispatch with unknown outcome');
    expect(body.messages[0].content).toContain('Type and Type_Name replace existing text');
    const current = body.messages.at(-1).content;
    const context = JSON.parse(current.find((part: { type: string }) => part.type === 'text').text);
    expect(context.protocolFeedback).toContain('Previous decision');
    expect(context.ui[0].text).toBe('Search');
    expect(context.completion).toEqual(input.completion);
    expect(context.completionStatus).toBe('pending_native_ui_verification');
    expect(body.messages[0].content).toContain('partially visible label');
    expect(current[1]).toMatchObject({ type: 'image_url' });
    expect(body.messages.map((message: { role: string }) => message.role)).toEqual(['system', 'user']);
    expect(body.top_p).toBeUndefined();
    expect(body.frequency_penalty).toBeUndefined();
  });

  it.each([
    { semanticControls: true }, { hierarchicalPlanning: true }, { semanticControls: true, hierarchicalPlanning: true },
  ])('keeps AutoGLM input unchanged for host controllers %j', async enhancements => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ choices: [{ message: { content: 'do(action="Tap", element=[200,300])' }, finish_reason: 'stop' }] }));
    vi.stubGlobal('fetch', fetch);
    const adapter = await createPhoneModel('test/autoglm', {} as Config, 'main');
    const input = prediction(); input.observation.elements = [element()];
    await adapter.predict(input, new AbortController().signal);
    await adapter.predict({ ...input, enhancements, planning: { steps: [{ goal: 'Inspect Search', textAll: ['Search'] }], currentStep: 0, verifiedSteps: 0 } }, new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1]!.body).toBe(fetch.mock.calls[0][1]!.body);
  });

  it('offers explicit native selectors to a structured model when semantic execution is enabled', async () => {
    vi.mocked(resolveModel).mockReturnValueOnce({ id: 'structured', provider: 'test', api: 'openai-completions', input: ['image'],
      baseUrl: 'https://phone.example/v1', phoneUse: { profile: 'structured-phone-v1' }, maxTokens: 4000 } as any);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ choices: [{ message: { content: JSON.stringify({
      kind: 'action', action: { type: 'tapElement', frameId: 'one', selector: { resourceId: 'app:id/search' } },
    }) }, finish_reason: 'stop' }] }));
    vi.stubGlobal('fetch', fetch);
    const adapter = await createPhoneModel('test/structured', {} as Config, 'main');
    const input = prediction(); input.observation.elements = [element()]; input.enhancements = { semanticControls: true };
    expect(await adapter.predict(input, new AbortController().signal)).toMatchObject({ action: { type: 'tapElement' } });
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(body.messages[0].content).toContain('Semantic controls are enabled');
    expect(JSON.parse(body.messages[1].content[0].text).nativeControls).toHaveLength(1);
  });

  it.each([['length', 'PHONE_MODEL_TRUNCATED'], ['content_filter', 'PHONE_MODEL_PROTOCOL']])('refuses noncompleted output (%s) even when its prefix looks executable', async (finishReason, code) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ choices: [{ message: { content: 'do(action="Back")' }, finish_reason: finishReason }] }));
    vi.stubGlobal('fetch', fetch);
    const adapter = await createPhoneModel('test/autoglm', {} as Config, 'main');
    await expect(adapter.predict(prediction(), new AbortController().signal)).rejects.toMatchObject({ code });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('obtains a bounded plan and semantic action in the same counted model request', async () => {
    const plan = { steps: [{ goal: 'Focus search', appPackage: 'com.example.app', textAll: ['Search'] }] };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ choices: [{ message: {
      content: `<plan>${JSON.stringify(plan)}</plan>do(action="TapElement", frameId="one", resourceId="app:id/search", text="Search")`,
    }, finish_reason: 'stop' }] }));
    vi.stubGlobal('fetch', fetch);
    const adapter = await createPhoneModel('test/autoglm', {} as Config, 'main');
    const value = prediction(); value.enhancements = { semanticControls: true, hierarchicalPlanning: true }; value.observation.elements = [element()];
    expect(await adapter.predict(value, new AbortController().signal)).toMatchObject({ kind: 'action', action: { type: 'tapElement', frameId: 'one' }, plan });
    expect(fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(body.messages[0].content).not.toContain('Completion-derived hierarchical execution is enabled');
    expect(body.messages[0].content).not.toContain('Semantic controls are enabled');
  });

  it('uses the normal first-action protocol with hierarchical execution and no hidden planner requests', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ choices: [{ message: { content: 'do(action="Back")' }, finish_reason: 'stop' }] }));
    vi.stubGlobal('fetch', fetch);
    const adapter = await createPhoneModel('test/autoglm', {} as Config, 'main');
    await expect(adapter.predict({ ...prediction(), enhancements: { hierarchicalPlanning: true } }, new AbortController().signal))
      .resolves.toEqual({ kind: 'action', action: { type: 'back' } });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

it('uses the existing Cloud credential and public model for phone predictions', async () => {
  vi.mocked(resolveModel).mockReturnValueOnce({ id: 'phone', provider: 'xopc-cloud', api: 'openai-completions', input: ['image'],
    baseUrl: 'https://cloud.example/v1', phoneUse: { profile: 'autoglm-phone-v1' }, maxTokens: 2048 } as any);
  const request = vi.fn<typeof globalThis.fetch>(async () => Response.json({ choices: [{ message: { content: 'do(action="Back")' }, finish_reason: 'stop' }] }));
  vi.stubGlobal('fetch', request);
  vi.mocked(getApiKey).mockResolvedValueOnce('initial-key').mockResolvedValueOnce('refreshed-key');
  const adapter = await createPhoneModel('xopc-cloud/phone', {} as Config, 'main');
  expect(await adapter.predict(prediction(), new AbortController().signal)).toMatchObject({ kind: 'action', action: { type: 'back' } });
  expect(getApiKey).toHaveBeenCalledWith('xopc-cloud', expect.objectContaining({ agentId: 'main' }));
  expect(String(request.mock.calls[0][0])).toBe('https://cloud.example/v1/chat/completions');
  expect(request.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer refreshed-key' });
  expect(JSON.parse((request.mock.calls[0] as any)[1].body)).toMatchObject({ model: 'phone', max_tokens: 2048, stream: false });
});

it('attaches the Cloud run budget and prevents another prediction after exhaustion', async () => {
  vi.mocked(resolveModel).mockReturnValueOnce({ id: 'phone', provider: 'xopc-cloud', api: 'openai-completions', input: ['image'],
    baseUrl: 'https://cloud.example/v1', phoneUse: { profile: 'autoglm-phone-v1' }, maxTokens: 2048 } as any);
  const budget = vi.spyOn(XopcCloudAccountService.prototype, 'createBudget').mockResolvedValue({ id: 'phone-budget' } as any);
  const request = vi.fn<typeof globalThis.fetch>(async () => Response.json({ error: { code: 'credit_budget_exhausted' } }, { status: 429 }));
  vi.stubGlobal('fetch', request);
  try {
    const adapter = await createPhoneModel('xopc-cloud/phone', {} as Config, 'main');
    await withCloudCreditBudget({ conversationId: 'phone-test', runId: 'run', limitCreditMicro: '100' }, async () => {
      await expect(adapter.predict(prediction(), new AbortController().signal)).rejects.toMatchObject({ code: 'PHONE_MODEL_HTTP' });
      expect(request.mock.calls[0][1]?.headers).toMatchObject({ 'x-xopc-credit-budget': 'phone-budget' });
      expect(cloudCreditBudgetStopMessage()).toContain('credit_budget_exhausted');
      await expect(adapter.predict(prediction(), new AbortController().signal)).rejects.toThrow('credit_budget_exhausted');
      expect(request).toHaveBeenCalledOnce();
    });
  } finally { budget.mockRestore(); }
});

it('distinguishes exhausted Cloud free quota from device failure and does not retry inference', async () => {
  vi.mocked(resolveModel).mockReturnValueOnce({ id: 'phone', provider: 'xopc-cloud', api: 'openai-completions', input: ['image'],
    baseUrl: 'https://cloud.example/v1', phoneUse: { profile: 'autoglm-phone-v1' }, maxTokens: 2048 } as any);
  const request = vi.fn<typeof globalThis.fetch>(async () => Response.json({ error: { code: 'free_quota_exhausted', message: 'untrusted upstream detail' } }, { status: 429, headers: { 'Retry-After': '3600' } }));
  vi.stubGlobal('fetch', request);
  const adapter = await createPhoneModel('xopc-cloud/phone', {} as Config, 'main');
  await expect(adapter.predict(prediction(), new AbortController().signal)).rejects.toMatchObject({ code: 'PHONE_MODEL_QUOTA_EXHAUSTED', message: expect.stringContaining('3600 seconds') });
  expect(request).toHaveBeenCalledOnce();
});
