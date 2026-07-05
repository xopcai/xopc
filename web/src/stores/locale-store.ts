import { create } from 'zustand';

import { htmlLangAttribute } from '@/lib/locale-default';
import {
  getLanguage,
  getStoredLanguage,
  type StoredLanguage,
  setLanguage as persistLanguage,
} from '@/lib/storage';

type LocaleState = {
  language: StoredLanguage;
  setLanguage: (lang: StoredLanguage) => void;
};

function isStoredLanguage(value: unknown): value is StoredLanguage {
  return value === 'en' || value === 'zh';
}

function applyRendererLanguage(language: StoredLanguage): void {
  persistLanguage(language);
  document.documentElement.setAttribute('lang', htmlLangAttribute(language));
}

function syncElectronLanguage(language: StoredLanguage): void {
  void window.electronAPI?.locale?.setLanguage(language).catch(() => {
    /* Electron menu language sync is best-effort. */
  });
}

export const useLocaleStore = create<LocaleState>((set) => ({
  language: getLanguage(),
  setLanguage: (language) => {
    applyRendererLanguage(language);
    set({ language });
    syncElectronLanguage(language);
  },
}));

export function syncElectronLocaleAfterHydration(): () => void {
  const api = window.electronAPI?.locale;
  if (!api) {
    return () => {};
  }

  let disposed = false;
  const storedLanguage = getStoredLanguage();
  if (storedLanguage) {
    syncElectronLanguage(storedLanguage);
  } else {
    void api.getLanguage().then((language) => {
      if (disposed || !isStoredLanguage(language)) return;
      applyRendererLanguage(language);
      useLocaleStore.setState({ language });
    });
  }

  const offChanged = api.onChanged((language) => {
    if (disposed || !isStoredLanguage(language)) return;
    applyRendererLanguage(language);
    useLocaleStore.setState({ language });
  });
  return () => {
    disposed = true;
    offChanged();
  };
}
