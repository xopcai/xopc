/** Locales supported by server-side message bundles (extend when adding JSON). */
export const SERVER_LOCALES = ['en', 'zh'] as const;

export type ServerLocale = (typeof SERVER_LOCALES)[number];

export const DEFAULT_SERVER_LOCALE: ServerLocale = 'en';

const SERVER_LOCALE_SET = new Set<string>(SERVER_LOCALES);

export function isServerLocale(v: string): v is ServerLocale {
  return SERVER_LOCALE_SET.has(v);
}

/** Map `zh-CN`, `EN`, etc. to a supported locale, or `undefined`. */
export function normalizeServerLocale(v: unknown): ServerLocale | undefined {
  if (v === 'zh' || v === 'en') return v;
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase();
  if (!t) return undefined;
  for (const loc of SERVER_LOCALES) {
    if (t === loc || t.startsWith(`${loc}-`)) return loc;
  }
  return undefined;
}

/** Unknown or missing → `DEFAULT_SERVER_LOCALE`. */
export function serverLocaleOrFallback(locale: ServerLocale | string | undefined | null): ServerLocale {
  if (locale && isServerLocale(String(locale))) return locale as ServerLocale;
  return normalizeServerLocale(locale) ?? DEFAULT_SERVER_LOCALE;
}
