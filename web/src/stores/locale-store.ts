import { create } from 'zustand';

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
    set({ language });
  },
}));
