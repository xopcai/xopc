/**
 * i18n message bundle barrel — mirrors web/src/i18n/messages.ts pattern.
 *
 * Usage:
 *   import { useMessages } from '../i18n/messages';
 *   const m = useMessages();
 *   <Text>{m.sessions.empty}</Text>
 */
import { en, type MessageBundle } from './locales/en';
import { zh } from './locales/zh';
import { usePreferencesStore, type Language } from '../stores/preferences-store';

export type { MessageBundle };

const bundles: Record<Language, MessageBundle> = { en, zh };

/** Get the message bundle for a given language code. */
export function messages(lang: Language): MessageBundle {
  return bundles[lang];
}

/** Hook — returns the current message bundle based on preferences store. */
export function useMessages(): MessageBundle {
  const lang = usePreferencesStore((s) => s.language);
  return bundles[lang];
}

/**
 * Simple template interpolation: replaces {{key}} with values.
 * Example: t('Hello {{name}}', { name: 'World' }) → 'Hello World'
 */
export function t(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    key in values ? String(values[key]) : `{{${key}}}`,
  );
}
