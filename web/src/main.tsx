import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app';
import { htmlLangAttribute } from '@/lib/locale-default';
import { getLanguage } from '@/lib/storage';
import { initGatewayFromWindow } from '@/stores/gateway-store';
import { hydrateFontScaleFromStorage } from '@/stores/font-scale-store';
import { hydrateThemeFromStorage } from '@/stores/theme-store';

import '@/styles/globals.css';

document.documentElement.setAttribute('lang', htmlLangAttribute(getLanguage()));

hydrateThemeFromStorage();
hydrateFontScaleFromStorage();

async function bootstrap(): Promise<void> {
  // Electron credentials arrive over IPC. Hydrate them before the first render so the
  // gateway-token landing does not flash between the startup page and the chat shell.
  await initGatewayFromWindow();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
