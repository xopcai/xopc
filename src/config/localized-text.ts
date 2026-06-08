import { z } from 'zod';

export type LocalizedTextMap = Record<string, string>;
export type LocalizedText = string | LocalizedTextMap;

const LOCALE_KEY_PATTERN = /^[a-z]{2}(?:-[A-Za-z]{2,8})?$/;

export const LocalizedTextSchema = z.union([
  z.string(),
  z.record(z.string().regex(LOCALE_KEY_PATTERN), z.string()),
]);

export function normalizeLocalizedText(value: LocalizedText | undefined): LocalizedText | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value)
    .map(([locale, text]) => [locale.trim(), String(text).trim()] as const)
    .filter(([locale, text]) => locale.length > 0 && text.length > 0);
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries);
}

export function resolveLocalizedText(
  value: LocalizedText | undefined,
  locale: string | undefined,
  fallbackLocale = 'en',
): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const normalizedLocale = locale?.trim();
  const localeBase = normalizedLocale?.split('-')[0];
  const fallbackBase = fallbackLocale.split('-')[0];
  const candidates = [
    normalizedLocale,
    localeBase,
    fallbackLocale,
    fallbackBase,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const text = value[candidate]?.trim();
    if (text) {
      return text;
    }
  }

  for (const text of Object.values(value)) {
    const trimmed = text.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}
