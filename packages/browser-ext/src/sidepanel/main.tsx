import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { loadExtensionLocalePreference } from '../i18n';
import { MicrophonePermission } from './microphone-permission';
import { SidePanelApp } from './sidepanel-app';
import { loadSidePanelThemePreference } from './theme';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Side Panel root is missing');

const [locale, theme] = await Promise.all([
  loadExtensionLocalePreference(),
  loadSidePanelThemePreference(),
]);

createRoot(root).render(
  <StrictMode>
    {new URLSearchParams(location.search).has('microphone-permission')
      ? <MicrophonePermission />
      : <SidePanelApp initialLocale={locale} initialTheme={theme} />}
  </StrictMode>,
);
