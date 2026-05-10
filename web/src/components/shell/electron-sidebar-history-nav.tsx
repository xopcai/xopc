import { ArrowLeft, ArrowRight } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { isElectron } from '@/lib/electron-env';
import { useLocaleStore } from '@/stores/locale-store';
import { useSidebarStore } from '@/stores/sidebar-store';

function readHistoryIdx(): number {
  const s = window.history.state;
  if (s && typeof s === 'object' && 'idx' in s) {
    const v = (s as { idx?: unknown }).idx;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return 0;
}

/**
 * Tracks the deepest `history.state.idx` seen in-session so we can dim “forward” when
 * there is no future entry (React Router hash history does not expose a direct API).
 */
function useHashHistoryNavAvailability() {
  const location = useLocation();
  const [maxIdx, setMaxIdx] = useState(() => readHistoryIdx());

  useLayoutEffect(() => {
    setMaxIdx((m) => Math.max(m, readHistoryIdx()));
  }, [location.key, location.pathname, location.search, location.hash]);

  useEffect(() => {
    const onPop = () => setMaxIdx((m) => Math.max(m, readHistoryIdx()));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const idx = readHistoryIdx();
  return {
    canBack: idx > 0,
    canForward: idx < maxIdx,
  };
}

/**
 * Electron + expanded left rail: hash-router back / forward, right-aligned in the chrome row.
 */
export const ElectronSidebarHistoryNav = memo(function ElectronSidebarHistoryNav({
  className,
}: {
  className?: string;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const navigate = useNavigate();
  const collapsed = useSidebarStore((s) => s.collapsed);
  const { canBack, canForward } = useHashHistoryNavAvailability();

  if (!isElectron() || collapsed) return null;

  return (
    <div className={cn('ml-auto flex shrink-0 items-center gap-0.5', className)}>
      <Button
        type="button"
        variant="ghost"
        disabled={!canBack}
        className={cn('size-8 shrink-0 rounded-xl p-0', APP_CHROME_NO_DRAG_CLASS)}
        title={m.historyBack}
        aria-label={m.historyBack}
        onClick={() => navigate(-1)}
      >
        <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={!canForward}
        className={cn('size-8 shrink-0 rounded-xl p-0', APP_CHROME_NO_DRAG_CLASS)}
        title={m.historyForward}
        aria-label={m.historyForward}
        onClick={() => navigate(1)}
      >
        <ArrowRight className="size-4" strokeWidth={1.5} aria-hidden />
      </Button>
    </div>
  );
});
