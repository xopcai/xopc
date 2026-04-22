import { describe, expect, it } from 'vitest';

import { inferDefaultLanguageFromEnvironment, uiLanguageFromLocaleTag } from '../locale-default';

describe('locale-default', () => {
  it('uiLanguageFromLocaleTag treats en variants as English', () => {
    expect(uiLanguageFromLocaleTag('en')).toBe('en');
    expect(uiLanguageFromLocaleTag('en-US')).toBe('en');
    expect(uiLanguageFromLocaleTag('en_GB')).toBe('en');
  });

  it('uiLanguageFromLocaleTag treats non-English as Chinese UI', () => {
    expect(uiLanguageFromLocaleTag('zh-CN')).toBe('zh');
    expect(uiLanguageFromLocaleTag('ja')).toBe('zh');
    expect(uiLanguageFromLocaleTag('fr')).toBe('zh');
  });

  it('uiLanguageFromLocaleTag empty → en', () => {
    expect(uiLanguageFromLocaleTag('')).toBe('en');
    expect(uiLanguageFromLocaleTag(undefined)).toBe('en');
  });

  it('inferDefaultLanguageFromEnvironment follows navigator.language', () => {
    const prevLang = navigator.language;
    const prevList = navigator.languages;
    try {
      Object.defineProperty(navigator, 'language', { value: 'zh-TW', configurable: true });
      Object.defineProperty(navigator, 'languages', { value: ['zh-TW'], configurable: true });
      expect(inferDefaultLanguageFromEnvironment()).toBe('zh');

      Object.defineProperty(navigator, 'language', { value: 'en-AU', configurable: true });
      expect(inferDefaultLanguageFromEnvironment()).toBe('en');
    } finally {
      Object.defineProperty(navigator, 'language', { value: prevLang, configurable: true });
      Object.defineProperty(navigator, 'languages', { value: prevList, configurable: true });
    }
  });
});
