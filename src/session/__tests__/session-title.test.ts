import { describe, expect, it } from 'vitest';

import { shouldAutoTitleSessionKey } from '../session-title.js';

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
