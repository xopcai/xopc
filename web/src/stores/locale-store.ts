import { create } from 'zustand';

import { applyDocumentLocale } from '@/i18n/document-locale';
import { fetchJson } from '@/lib/fetch';
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
  applyDocumentLocale(language);
}

function syncElectronLanguage(language: StoredLanguage): void {
  void window.electronAPI?.locale?.setLanguage(language).catch(() => {
    /* Electron menu language sync is best-effort. */
  });
}

function syncGatewayLanguage(language: StoredLanguage): void {
  if (!useGatewayStore.getState().token) return;
  const requests = [
    fetchJson(apiUrl('/api/voice/language'), {
      method: 'POST',
      body: JSON.stringify({ language }),
    }),
    fetchJson(apiUrl('/api/you/profile'), {
      method: 'PATCH',
      body: JSON.stringify({ locale: language === 'zh' ? 'zh-CN' : 'en' }),
    }),
  ];
  void Promise.allSettled(requests);
}

export const useLocaleStore = create<LocaleState>((set) => ({
  language: getLanguage(),
  setLanguage: (language) => {
    applyRendererLanguage(language);
    set({ language });
    syncElectronLanguage(language);
    syncGatewayLanguage(language);
  },
}));

export function syncElectronLocaleAfterHydration(): () => void {
  syncGatewayLanguage(useLocaleStore.getState().language);
  const offGateway = useGatewayStore.subscribe((state, previous) => {
    if (state.token && state.token !== previous.token) {
      syncGatewayLanguage(useLocaleStore.getState().language);
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
      syncGatewayLanguage(language);
    });
  }

  const offChanged = api.onChanged((language) => {
    if (disposed || !isStoredLanguage(language)) return;
    applyRendererLanguage(language);
    useLocaleStore.setState({ language });
    syncGatewayLanguage(language);
  });
  return () => {
    disposed = true;
    offChanged();
    offGateway();
  };
}
