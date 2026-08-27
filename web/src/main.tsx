import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app';
import { AppErrorBoundary, AppErrorFallback } from '@/components/errors/app-error-boundary';
import { installGlobalErrorRecovery } from '@/components/errors/global-error-recovery';
import { applyDocumentLocale } from '@/i18n/document-locale';
import { getLanguage } from '@/lib/storage';
import { initGatewayFromWindow } from '@/stores/gateway-store';
import { hydrateFontScaleFromStorage } from '@/stores/font-scale-store';
import { hydrateThemeFromStorage } from '@/stores/theme-store';

import '@/styles/globals.css';

async function bootstrap(): Promise<void> {
  const root = createRoot(document.getElementById('root')!);
  let fatalErrorShown = false;
  const showFatalError = (
    error: unknown,
    source: 'bootstrap' | 'window.error' | 'unhandledrejection',
  ) => {
    if (fatalErrorShown) return;
    fatalErrorShown = true;
    console.error(`Renderer fatal error (${source})`, error);
    root.render(<AppErrorFallback error={error} source={source} />);
  };
  installGlobalErrorRecovery(showFatalError);

  // Electron credentials arrive over IPC. Hydrate them before the first render so the
  // gateway-token landing does not flash between the startup page and the chat shell.
  try {
    applyDocumentLocale(getLanguage());
    hydrateThemeFromStorage();
    hydrateFontScaleFromStorage();
    await initGatewayFromWindow();
    root.render(
      <StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </StrictMode>,
    );
  } catch (error) {
    showFatalError(error, 'bootstrap');
  }
}

void bootstrap();
