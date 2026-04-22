import { create } from 'zustand';

import { i18n } from '@/i18n/i18n';
import { htmlLangAttribute } from '@/lib/locale-default';
import { getLanguage, type StoredLanguage, setLanguage as persistLanguage } from '@/lib/storage';

type LocaleState = {
  language: StoredLanguage;
  setLanguage: (lang: StoredLanguage) => void;
};

export const useLocaleStore = create<LocaleState>((set) => ({
  language: getLanguage(),
  setLanguage: (language) => {
    persistLanguage(language);
    document.documentElement.setAttribute('lang', htmlLangAttribute(language));
    void i18n.changeLanguage(language);
    set({ language });
  },
}));
