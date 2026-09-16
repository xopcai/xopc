export type ExtensionLocale = 'en' | 'zh-CN';

type LocaleMessage = {
  message: string;
  placeholders?: Record<string, { content: string }>;
};

type LocaleCatalog = Record<string, LocaleMessage>;

const LOCALE_STORAGE_KEY = 'xopc.sidepanel.locale';
const LOCALE_PATHS: Record<ExtensionLocale, string> = {
  en: '_locales/en/messages.json',
  'zh-CN': '_locales/zh_CN/messages.json',
};

let activeLocale: ExtensionLocale | undefined;
let activeCatalog: LocaleCatalog | undefined;

function isExtensionLocale(value: unknown): value is ExtensionLocale {
  return value === 'en' || value === 'zh-CN';
}

function browserLocale(): ExtensionLocale {
  return chrome.i18n.getUILanguage().replaceAll('_', '-').toLowerCase().startsWith('zh')
    ? 'zh-CN'
    : 'en';
}

function messageWithSubstitutions(entry: LocaleMessage, substitutions?: string | string[]): string {
  const values = substitutions === undefined
    ? []
    : Array.isArray(substitutions) ? substitutions : [substitutions];
  const valueAt = (content: string) => content.replace(/\$(\d+)/g, (_match, index: string) => (
    values[Number(index) - 1] ?? ''
  ));
  let message = entry.message;
  for (const [name, placeholder] of Object.entries(entry.placeholders ?? {})) {
    message = message.replaceAll(new RegExp(`\\$${name}\\$`, 'gi'), valueAt(placeholder.content));
  }
  let sequentialIndex = 0;
  return message
    .replace(/%(?:(\d+)\$)?s/g, (_match, position: string | undefined) => {
      const index = position ? Number(position) - 1 : sequentialIndex++;
      return values[index] ?? '';
    })
    .replace(/\$(\d+)/g, (_match, index: string) => values[Number(index) - 1] ?? '');
}

export function t(key: string, substitutions?: string | string[]): string {
  const entry = activeCatalog?.[key];
  return entry
    ? messageWithSubstitutions(entry, substitutions)
    : chrome.i18n.getMessage(key, substitutions) || key;
}

export function extensionLocale(): string {
  if (activeLocale) return activeLocale;
  return typeof chrome === 'undefined' ? 'en' : chrome.i18n.getUILanguage().replaceAll('_', '-');
}

export async function loadExtensionLocalePreference(): Promise<ExtensionLocale> {
  const stored = await chrome.storage.local.get(LOCALE_STORAGE_KEY);
  const locale = isExtensionLocale(stored[LOCALE_STORAGE_KEY])
    ? stored[LOCALE_STORAGE_KEY]
    : browserLocale();
  await applyExtensionLocale(locale);
  return locale;
}

export async function saveExtensionLocalePreference(locale: ExtensionLocale): Promise<void> {
  await chrome.storage.local.set({ [LOCALE_STORAGE_KEY]: locale });
  await applyExtensionLocale(locale);
}

export async function applyExtensionLocale(locale: ExtensionLocale): Promise<void> {
  const response = await fetch(chrome.runtime.getURL(LOCALE_PATHS[locale]));
  if (!response.ok) throw new Error(`Could not load extension locale: ${locale}`);
  activeCatalog = await response.json() as LocaleCatalog;
  activeLocale = locale;
  initializeDocumentLocale();
}

export function initializeDocumentLocale(): void {
  document.documentElement.lang = extensionLocale();
  document.documentElement.dir = chrome.i18n.getMessage('@@bidi_dir') || 'ltr';
  document.title = t('appName');
}
