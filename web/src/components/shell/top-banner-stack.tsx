import { useEffect, useRef, type ReactNode } from 'react';

const TOAST_TOP_INSET_VAR = '--toast-top-inset';
/** Gap between the bottom of the banner stack and the first toast. */
const TOAST_BANNER_GAP_PX = 8;
const TOAST_TOP_FALLBACK = '0.75rem';

/**
 * Measures visible top banners (update reminder, gateway restart, etc.) and publishes
 * `--toast-top-inset` on `:root` so `ToastHost` sits below them.
 */
export function TopBannerStack({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const height = el.getBoundingClientRect().height;
      if (height > 0) {
        document.documentElement.style.setProperty(
          TOAST_TOP_INSET_VAR,
          `${Math.ceil(height + TOAST_BANNER_GAP_PX)}px`,
        );
      } else {
        document.documentElement.style.removeProperty(TOAST_TOP_INSET_VAR);
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty(TOAST_TOP_INSET_VAR);
    };
  }, []);

  return (
    <div ref={ref} className="shrink-0">
      {children}
    </div>
  );
}

export { TOAST_TOP_FALLBACK, TOAST_TOP_INSET_VAR };
