import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';

import { ScenesPage } from '../src/features/scenes/scenes-page';
import { useLocaleStore } from '../src/stores/locale-store';
import '../src/styles/globals.css';

useLocaleStore.setState({ language: 'zh' });
const router = createHashRouter(['/scenes', '/scenes/inbox', '/scenes/new/:templateKey', '/scenes/:activationId'].map((path) => ({ path, element: <ScenesPage /> })));
createRoot(document.getElementById('root')!).render(<div className="h-dvh"><RouterProvider router={router} /></div>);
