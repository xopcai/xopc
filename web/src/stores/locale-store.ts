import { create } from 'zustand';

import { fetchJson } from '@/lib/fetch';
import { htmlLangAttribute } from '@/lib/locale-default';
import { apiUrl } from '@/lib/url';
import {
  getLanguage,
  getStoredLanguage,
  type StoredLanguage,
  setLanguage as persistLanguage,
} from '@/lib/storage';
import { useGatewayStore } from '@/stores/gateway-store';

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

function syncGatewayVoiceLanguage(language: StoredLanguage): void {
  if (!useGatewayStore.getState().token) return;
  void fetchJson(apiUrl('/api/voice/language'), {
    method: 'POST',
    body: JSON.stringify({ language }),
  }).catch(() => {
    /* Language sync must never block or interrupt the settings experience. */
  });
}

export const useLocaleStore = create<LocaleState>((set) => ({
  language: getLanguage(),
  setLanguage: (language) => {
    applyRendererLanguage(language);
    set({ language });
    syncElectronLanguage(language);
    syncGatewayVoiceLanguage(language);
  },
}));

export function syncElectronLocaleAfterHydration(): () => void {
  syncGatewayVoiceLanguage(useLocaleStore.getState().language);
  const offGateway = useGatewayStore.subscribe((state, previous) => {
    if (state.token && state.token !== previous.token) {
      syncGatewayVoiceLanguage(useLocaleStore.getState().language);
    }
  });
  const api = window.electronAPI?.locale;
  if (!api) {
    return offGateway;
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
      syncGatewayVoiceLanguage(language);
    });
  }

  const offChanged = api.onChanged((language) => {
    if (disposed || !isStoredLanguage(language)) return;
    applyRendererLanguage(language);
    useLocaleStore.setState({ language });
    syncGatewayVoiceLanguage(language);
  });
  return () => {
    disposed = true;
    offChanged();
    offGateway();
  };
}
