import shareToolEn from './locales/share-tool.en.json';
import shareToolZh from './locales/share-tool.zh.json';

import { formatI18n } from './format.js';
import {
  DEFAULT_SERVER_LOCALE,
  normalizeServerLocale,
  serverLocaleOrFallback,
  type ServerLocale,
} from './locale.js';

export type ShareToolMessages = typeof shareToolEn;

const byLocale: Record<ServerLocale, ShareToolMessages> = {
  en: shareToolEn,
  zh: shareToolZh,
};

export function shareToolMessages(locale: ServerLocale): ShareToolMessages {
  return byLocale[serverLocaleOrFallback(locale)];
}

/**
 * Best-effort locale resolution for tools that don't yet receive an explicit
 * locale signal. Order: explicit arg → env (LANG / LC_ALL / LANGUAGE) → default.
 */
export function resolveToolLocale(explicit?: string | null): ServerLocale {
  if (explicit) {
    const n = normalizeServerLocale(explicit);
    if (n) return n;
  }
  for (const key of ['LC_ALL', 'LANG', 'LANGUAGE'] as const) {
    const v = process.env[key];
    if (!v) continue;
    // Unix env vars use `zh_CN.UTF-8`; normalizer expects `zh-CN`.
    const stripped = v.split('.')[0].replace(/_/g, '-');
    const n = normalizeServerLocale(stripped);
    if (n) return n;
  }
  return DEFAULT_SERVER_LOCALE;
}

export function shareToolSuccessLines(
  locale: ServerLocale,
  vars: {
    kind: string;
    shareUrl: string;
    title: string;
    expiresAt: string;
    thumbnailUrl: string;
    reachability: string;
    reachabilityHint: string;
    isPublic: boolean;
  },
): string[] {
  const m = shareToolMessages(locale).success;
  return [
    formatI18n(m.headline, { kind: vars.kind, shareUrl: vars.shareUrl }),
    vars.isPublic
      ? ''
      : formatI18n(m.reachabilityWarning, {
          reachability: vars.reachability,
          hint: vars.reachabilityHint,
        }),
    formatI18n(m.title, { title: vars.title }),
    formatI18n(m.expiresAt, { expiresAt: vars.expiresAt }),
    formatI18n(m.thumbnail, { thumbnailUrl: vars.thumbnailUrl }),
  ];
}

export function shareToolErrorLine(locale: ServerLocale, message: string): string {
  return formatI18n(shareToolMessages(locale).error.prefix, { message });
}
