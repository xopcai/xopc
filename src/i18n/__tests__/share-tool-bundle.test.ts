import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveToolLocale,
  shareToolErrorLine,
  shareToolMessages,
  shareToolSuccessLines,
} from '../share-tool-bundle.js';

describe('resolveToolLocale', () => {
  const originalEnv = { LC_ALL: process.env.LC_ALL, LANG: process.env.LANG, LANGUAGE: process.env.LANGUAGE };
  beforeEach(() => {
    delete process.env.LC_ALL;
    delete process.env.LANG;
    delete process.env.LANGUAGE;
  });
  afterEach(() => {
    process.env.LC_ALL = originalEnv.LC_ALL;
    process.env.LANG = originalEnv.LANG;
    process.env.LANGUAGE = originalEnv.LANGUAGE;
  });

  it('honors explicit arg first', () => {
    process.env.LANG = 'en_US.UTF-8';
    expect(resolveToolLocale('zh-CN')).toBe('zh');
  });

  it('falls back to LC_ALL, then LANG, then LANGUAGE', () => {
    process.env.LANG = 'zh_CN.UTF-8';
    expect(resolveToolLocale()).toBe('zh');
  });

  it('strips .UTF-8 and similar suffixes', () => {
    process.env.LANG = 'zh_CN.UTF-8';
    expect(resolveToolLocale()).toBe('zh');
  });

  it('defaults to en when env locales are unknown', () => {
    process.env.LANG = 'fr_FR.UTF-8';
    expect(resolveToolLocale()).toBe('en');
  });

  it('defaults to en when no signal', () => {
    expect(resolveToolLocale()).toBe('en');
  });
});

describe('shareToolMessages', () => {
  it('zh bundle exposes the success keys', () => {
    const m = shareToolMessages('zh');
    expect(m.success.headline).toContain('分享链接已生成');
    expect(m.success.title).toContain('标题');
  });
  it('en bundle uses English', () => {
    const m = shareToolMessages('en');
    expect(m.success.headline).toContain('Share link created');
    expect(m.success.title).toContain('Title');
  });
});

describe('shareToolSuccessLines', () => {
  const baseVars = {
    kind: 'site',
    shareUrl: 'https://example/abc/',
    title: 'Plan',
    expiresAt: '2026-06-06T00:00:00Z',
    thumbnailUrl: 'https://example/abc/thumbnail',
    reachability: 'public',
    reachabilityHint: '',
    isPublic: true,
  };

  it('omits the reachability warning when public', () => {
    const lines = shareToolSuccessLines('zh', baseVars);
    expect(lines[1]).toBe('');
    expect(lines.join(' ')).not.toContain('当前可达性');
  });

  it('includes the reachability warning when not public', () => {
    const lines = shareToolSuccessLines('zh', {
      ...baseVars,
      reachability: 'local-only',
      reachabilityHint: '仅本机可访问',
      isPublic: false,
    });
    expect(lines[1]).toContain('当前可达性');
    expect(lines[1]).toContain('仅本机可访问');
  });

  it('interpolates all the placeholders in en', () => {
    const lines = shareToolSuccessLines('en', baseVars);
    expect(lines[0]).toContain('site');
    expect(lines[0]).toContain('https://example/abc/');
    expect(lines[2]).toContain('Plan');
  });
});

describe('shareToolErrorLine', () => {
  it('localizes the prefix', () => {
    expect(shareToolErrorLine('zh', 'boom')).toContain('create_share 失败');
    expect(shareToolErrorLine('en', 'boom')).toContain('create_share failed');
  });
});
