import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/i18n/i18n';
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
initGatewayFromWindow();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
