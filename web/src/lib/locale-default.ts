/**
 * Default UI language from OS / browser locale.
 * Rule: Chinese (`zh`, `zh-*`) → `zh`; unsupported locales → `en`.
 */

export type UiLanguage = 'en' | 'zh';

/** Map BCP 47 / POSIX-ish tags (e.g. en-US, zh_CN). */
export function uiLanguageFromLocaleTag(locale: string | undefined | null): UiLanguage {
  const t = (locale ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!t) return 'en';
  return t === 'zh' || t.startsWith('zh-') ? 'zh' : 'en';
}

/** Browser or Electron renderer: use primary `navigator.language`. */
export function inferDefaultLanguageFromEnvironment(): UiLanguage {
  if (typeof navigator === 'undefined') {
    return 'en';
  }
  const tag = (navigator.language || navigator.languages?.[0] || '').trim();
  if (!tag) return 'en';
  return uiLanguageFromLocaleTag(tag);
}

export function htmlLangAttribute(lang: UiLanguage): string {
  return lang === 'zh' ? 'zh-CN' : 'en';
}
