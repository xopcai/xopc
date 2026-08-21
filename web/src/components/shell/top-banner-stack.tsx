import type { ReactNode } from 'react';

/**
 * Groups visible top banners (update reminder, gateway restart, etc.).
 */
export function TopBannerStack({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0">
      {children}
    </div>
  );
}
