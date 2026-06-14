import { describe, expect, it } from 'vitest';

import {
  fallbackTitleFromMessages,
  provisionalTitleFromUserText,
  shouldAutoTitleSessionKey,
} from '../session-title.ts';

describe('shouldAutoTitleSessionKey', () => {
  it('allows webchat, telegram, weixin-style keys', () => {
    expect(shouldAutoTitleSessionKey('agent:main:webchat:default:direct:chat_abc')).toBe(true);
    expect(shouldAutoTitleSessionKey('agent:main:telegram:acc_default:direct:123456')).toBe(true);
    expect(shouldAutoTitleSessionKey('agent:main:weixin:acc_default:direct:openid123')).toBe(true);
  });

  it('rejects cron sessions', () => {
    expect(shouldAutoTitleSessionKey('agent:main:cron:job-123')).toBe(false);
  });

  it('rejects heartbeat keys', () => {
    expect(shouldAutoTitleSessionKey('heartbeat:main')).toBe(false);
    expect(shouldAutoTitleSessionKey('heartbeat:isolated:ts')).toBe(false);
  });

  it('rejects empty key', () => {
    expect(shouldAutoTitleSessionKey('')).toBe(false);
    expect(shouldAutoTitleSessionKey('   ')).toBe(false);
  });
});

describe('provisionalTitleFromUserText', () => {
  it('uses first line and strips envelope timestamp', () => {
    expect(provisionalTitleFromUserText('[2026-01-15 10:00 UTC] 你好')).toBe('你好');
  });

  it('returns null for blank input', () => {
    expect(provisionalTitleFromUserText('   ')).toBeNull();
  });
});

describe('fallbackTitleFromMessages', () => {
  it('ignores leading envelope timestamp on first user message', () => {
    const title = fallbackTitleFromMessages([
      {
        role: 'user',
        content: [{ type: 'text', text: '[2026-01-15 10:00 UTC] 你好' }],
      },
    ]);
    expect(title).toBe('你好');
  });
});
