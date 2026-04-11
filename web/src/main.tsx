import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app';
import { initGatewayFromWindow } from '@/stores/gateway-store';
import { bootstrapFontScale } from '@/stores/font-scale-store';
import { bootstrapTheme } from '@/stores/theme-store';

import '@/styles/globals.css';

bootstrapTheme();
bootstrapFontScale();
initGatewayFromWindow();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
