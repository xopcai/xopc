import { Outlet } from 'react-router-dom';

/**
 * Fills `AppShell` `<main>` so nested chat routes (`ChatPage`) get a bounded height
 * and the message column + bottom composer can use flex-1 / shrink-0 correctly.
 */
export function ChatRouteLayout() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <Outlet />
    </div>
  );
}
