import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { getLanguage } from '@/lib/storage';

import en from './locales/en.json' with { type: 'json' };
import zh from './locales/zh.json' with { type: 'json' };

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: getLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export { i18n };
