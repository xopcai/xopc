import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';

import { ScenesPage } from '../src/features/scenes/scenes-page';
import { usePageHeaderStore } from '../src/stores/page-header-store';
import { useLocaleStore } from '../src/stores/locale-store';
import '../src/styles/globals.css';

useLocaleStore.setState({ language: 'zh' });
const router = createHashRouter(['/scenes', '/scenes/inbox', '/scenes/new/:templateKey', '/scenes/:activationId'].map((path) => ({ path, element: <div className="flex h-dvh flex-col"><PageHeader /><div className="min-h-0 flex-1"><ScenesPage /></div></div> })));
export function PageHeader() {
  const header = usePageHeaderStore();
  return <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge p-4">{header.startExtra}{header.main}<div className="flex gap-2">{header.end}</div></header>;
}
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
