import { describe, expect, it } from 'vitest';

import type { Config } from '../../../config/schema.js';
import {
  resolveDeliverableChannels,
  resolvePromptMode,
  resolveRuntimeChannel,
} from '../system-prompt-params.js';

describe('resolvePromptMode', () => {
  it('returns minimal for subagent and cron session keys', () => {
    expect(resolvePromptMode('subagent:abc')).toBe('minimal');
    expect(resolvePromptMode('agent:main:subagent:task-1')).toBe('minimal');
    expect(resolvePromptMode('agent:main:cron:job-1')).toBe('minimal');
  });

  it('returns full for normal sessions', () => {
    expect(resolvePromptMode('agent:main:telegram:direct:123')).toBe('full');
    expect(resolvePromptMode(undefined)).toBe('full');
  });
});

describe('resolveRuntimeChannel', () => {
  it('extracts channel source from session key', () => {
    expect(resolveRuntimeChannel('agent:main:telegram:direct:123')).toBe('telegram');
    expect(resolveRuntimeChannel('agent:main:main')).toBe('cli');
  });
});

describe('resolveDeliverableChannels', () => {
  it('always includes webchat and cli', () => {
    const channels = resolveDeliverableChannels({} as Config);
    expect(channels).toContain('webchat');
    expect(channels).toContain('cli');
  });

  it('includes enabled configured channel plugins', () => {
    const channels = resolveDeliverableChannels({
      channels: {
        telegram: { enabled: true, accounts: {} },
      },
    } as Config);
    expect(channels).toContain('telegram');
  });
});
