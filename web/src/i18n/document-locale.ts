import { htmlLangAttribute } from '@/lib/locale-default';
import type { StoredLanguage } from '@/lib/storage';

import { messages } from './messages';

export function applyDocumentLocale(language: StoredLanguage): void {
  document.documentElement.setAttribute('lang', htmlLangAttribute(language));
  document.title = messages(language).appTitle;
}
