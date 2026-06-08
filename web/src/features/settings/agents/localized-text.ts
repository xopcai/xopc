import type { StoredLanguage } from '@/lib/storage';
import type { LocalizedText } from '@/features/settings/types/agent-gateway';

export function languageToLocaleKey(language: StoredLanguage): string {
  return language === 'zh' ? 'zh' : 'en';
}

export function languageDisplayName(language: StoredLanguage): string {
  return language === 'zh' ? '中文' : 'English';
}

export function localizedTextToMap(value: LocalizedText | undefined): Record<string, string> {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    return { en: value };
  }
  return { ...value };
}

export function localizedTextForLanguage(
  value: LocalizedText | undefined,
  language: StoredLanguage,
): string | undefined {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  if (!value) {
    return undefined;
  }
  const localeKey = languageToLocaleKey(language);
  return value[localeKey]?.trim() || value.en?.trim() || value.zh?.trim() || undefined;
}

export function mergeLocalizedTextForLanguage(
  base: LocalizedText | undefined,
  language: StoredLanguage,
  nextValue: string,
): LocalizedText | undefined {
  const localeKey = languageToLocaleKey(language);
  const nextMap = localizedTextToMap(base);
  const trimmedValue = nextValue.trim();
  if (trimmedValue) {
    nextMap[localeKey] = trimmedValue;
  } else {
    delete nextMap[localeKey];
  }
  const entries = Object.entries(nextMap).filter(([, text]) => text.trim().length > 0);
  if (entries.length === 0) {
    return undefined;
  }
  if (entries.length === 1 && entries[0]?.[0] === 'en') {
    return entries[0][1].trim();
  }
  return Object.fromEntries(entries.map(([locale, text]) => [locale, text.trim()]));
}

export function localizedTextEquals(a: LocalizedText | undefined, b: LocalizedText | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function collectLocalizedSearchText(value: LocalizedText | undefined): string[] {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    const text = value.trim();
    return text ? [text] : [];
  }
  return Object.values(value)
    .map((text) => text.trim())
    .filter(Boolean);
}
