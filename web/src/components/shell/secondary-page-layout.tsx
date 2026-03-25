import { Outlet } from 'react-router-dom';

import { SecondaryPageTopBar } from '@/components/shell/secondary-page-top-bar';

/** Layout for non-chat routes: mobile top bar (menu + back to chat) + scrollable page body. */
export function SecondaryPageLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <SecondaryPageTopBar />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
