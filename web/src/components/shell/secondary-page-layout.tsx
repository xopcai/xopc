import { Outlet } from 'react-router-dom';

/** Layout for non-chat routes: mobile menu lives in {@link PrimaryAppHeader}. */
export function SecondaryPageLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
