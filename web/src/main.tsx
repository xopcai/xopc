import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app';
import { bootstrapLegacyHash } from '@/lib/legacy-hash';
import { initGatewayFromWindow } from '@/stores/gateway-store';
import { bootstrapTheme } from '@/stores/theme-store';

import '@/styles/globals.css';

bootstrapTheme();
bootstrapLegacyHash();
initGatewayFromWindow();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
