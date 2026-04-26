import { describe, expect, it } from 'vitest';

import { fallbackTitleFromMessages, shouldAutoTitleSessionKey } from '../session-title.ts';

describe('shouldAutoTitleSessionKey', () => {
  it('allows webchat, telegram, weixin-style keys', () => {
    expect(shouldAutoTitleSessionKey('main:webchat:default:direct:chat_abc')).toBe(true);
    expect(shouldAutoTitleSessionKey('main:telegram:acc_default:dm:123456')).toBe(true);
    expect(shouldAutoTitleSessionKey('main:weixin:acc_default:dm:openid123')).toBe(true);
  });

  it('rejects cron sessions', () => {
    expect(shouldAutoTitleSessionKey('main:cron:default:dm:job-123')).toBe(false);
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
