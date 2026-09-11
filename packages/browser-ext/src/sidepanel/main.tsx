import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SidePanelApp } from './sidepanel-app';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Side Panel root is missing');

createRoot(root).render(
  <StrictMode>
    <SidePanelApp />
  </StrictMode>,
);
