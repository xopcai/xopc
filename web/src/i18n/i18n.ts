import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { getLanguage } from '@/lib/storage';

import { en, zh } from './locales/bundle';

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
