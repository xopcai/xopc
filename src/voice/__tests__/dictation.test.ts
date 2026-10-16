import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';

const mocks = vi.hoisted(() => ({ available: vi.fn(), streaming: vi.fn() }));
vi.mock('../stt/index.js', () => ({
  resolveSTTProviderChain: (config: { provider: string }) => mocks.available() ? [{ id: config.provider }] : [],
  mergeSttConfigFromAppConfig: (config: unknown) => config,
}));
vi.mock('../realtime/runtime.js', () => ({ resolveStreamingStt: mocks.streaming }));
import { resolveDictationRoute } from '../dictation.js';

describe('dictation configuration compatibility', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.available.mockReturnValue(true); });
  const config = () => ConfigSchema.parse({
    tools: { media: { audio: { enabled: true, provider: 'qwen-token-plan-cn' } } },
    voice: { realtime: { enabled: true } },
  });
  it('reuses a recorded-audio provider without requiring realtime voice', () => {
    const cfg = config(); cfg.voice.realtime.enabled = false;
    expect(resolveDictationRoute(cfg)).toEqual({ mode: 'recorded', provider: 'qwen-token-plan-cn' });
    expect(mocks.streaming).not.toHaveBeenCalled();
  });
  it('does not select an implicit streaming fallback from another service', () => {
    mocks.streaming.mockReturnValue({ route: { provider: 'xopc-cloud' } });
    expect(resolveDictationRoute(config())).toEqual({ mode: 'recorded', provider: 'qwen-token-plan-cn' });
  });
  it('preserves an explicitly selected legacy streaming provider', () => {
    const cfg = config(); cfg.voice.realtime.stt = { provider: 'alibaba' };
    mocks.streaming.mockReturnValue({ route: { provider: 'alibaba' } });
    expect(resolveDictationRoute(cfg)).toEqual({ mode: 'streaming', provider: 'alibaba' });
  });
  it('does not replace an unavailable explicit streaming selection with recorded billing', () => {
    const cfg = config(); cfg.voice.realtime.stt = { provider: 'missing' };
    expect(resolveDictationRoute(cfg)).toEqual({ mode: 'unavailable' });
  });
  it('preserves streaming on a shared capable provider', () => {
    mocks.streaming.mockReturnValue({ route: { provider: 'qwen-token-plan-cn' } });
    expect(resolveDictationRoute(config()).mode).toBe('streaming');
  });
  it('reports unavailable rather than bypassing a disabled recorded provider', () => {
    mocks.available.mockReturnValue(false);
    expect(resolveDictationRoute(config())).toEqual({ mode: 'unavailable' });
  });
});
