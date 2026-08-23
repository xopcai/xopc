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

type GatewayLanguageSyncTarget = {
  token: string;
  language: StoredLanguage;
};

let activeGatewayLanguageSync: GatewayLanguageSyncTarget | undefined;
let pendingGatewayLanguageSync: GatewayLanguageSyncTarget | undefined;
let lastSuccessfulGatewayLanguageSync: GatewayLanguageSyncTarget | undefined;
let gatewayLanguageSyncDrain: Promise<void> | undefined;

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

function isSameGatewayLanguageSync(
  left: GatewayLanguageSyncTarget | undefined,
  right: GatewayLanguageSyncTarget,
): boolean {
  return left?.token === right.token && left.language === right.language;
}

async function drainGatewayLanguageSync(): Promise<void> {
  while (pendingGatewayLanguageSync) {
    const target = pendingGatewayLanguageSync;
    pendingGatewayLanguageSync = undefined;
    activeGatewayLanguageSync = target;

    const results = await Promise.allSettled([
      fetchJson(apiUrl('/api/voice/language'), {
        method: 'POST',
        body: JSON.stringify({ language: target.language }),
      }),
      fetchJson(apiUrl('/api/you/profile'), {
        method: 'PATCH',
        body: JSON.stringify({ locale: target.language === 'zh' ? 'zh-CN' : 'en' }),
      }),
    ]);

    if (results.every((result) => result.status === 'fulfilled')) {
      lastSuccessfulGatewayLanguageSync = target;
    }
    activeGatewayLanguageSync = undefined;
  }
}

function startGatewayLanguageSyncDrain(): void {
  if (gatewayLanguageSyncDrain) return;
  gatewayLanguageSyncDrain = drainGatewayLanguageSync().finally(() => {
    gatewayLanguageSyncDrain = undefined;
    if (pendingGatewayLanguageSync) startGatewayLanguageSyncDrain();
  });
}

function syncGatewayLanguage(language: StoredLanguage): void {
  const token = useGatewayStore.getState().token;
  if (!token) return;

  const target = { token, language };
  if (isSameGatewayLanguageSync(activeGatewayLanguageSync, target)) {
    // The latest signal matches the request already on the wire, so an older
    // queued language can be discarded without issuing another request.
    pendingGatewayLanguageSync = undefined;
    return;
  }
  if (
    isSameGatewayLanguageSync(pendingGatewayLanguageSync, target) ||
    (!activeGatewayLanguageSync && isSameGatewayLanguageSync(lastSuccessfulGatewayLanguageSync, target))
  ) {
    return;
  }

  // React StrictMode mounts effects twice in development, and Electron may echo
  // the same locale through onChanged. Coalesce those signals so this background
  // preference sync does not consume the shared strict mutation-rate budget.
  pendingGatewayLanguageSync = target;
  startGatewayLanguageSyncDrain();
}

/** Test-only — reset successful sync memory between cases. */
export function __resetGatewayLanguageSyncForTests(): void {
  activeGatewayLanguageSync = undefined;
  pendingGatewayLanguageSync = undefined;
  lastSuccessfulGatewayLanguageSync = undefined;
  gatewayLanguageSyncDrain = undefined;
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
