// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';

import { formatApiHttpError } from '../http-error-message';

describe('formatApiHttpError', () => {
  const originalLanguage = useLocaleStore.getState().language;

  afterEach(() => {
    useLocaleStore.setState({ language: originalLanguage });
  });

  it('localizes generic rate-limit responses instead of exposing server boilerplate', () => {
    useLocaleStore.setState({ language: 'zh' });
    expect(formatApiHttpError(429, 'Too Many Requests', 'Too many requests'))
      .toBe('请求过于频繁，请稍后再试。');

    useLocaleStore.setState({ language: 'en' });
    expect(formatApiHttpError(429, 'Too Many Requests', 'rate_limited'))
      .toBe('Too many requests. Please try again later.');
  });
});
