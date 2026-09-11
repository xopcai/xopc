import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SidePanelApp } from './sidepanel-app';
import { applySystemSidePanelTheme } from './theme';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Side Panel root is missing');

applySystemSidePanelTheme();

createRoot(root).render(
  <StrictMode>
    <SidePanelApp />
  </StrictMode>,
);
