import { ArrowLeft, ArrowRight } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { isElectron } from '@/lib/electron-env';
import { useLocaleStore } from '@/stores/locale-store';

function readHistoryIdx(): number {
  const state = window.history.state;
  if (state && typeof state === 'object' && 'idx' in state) {
    const idx = (state as { idx?: unknown }).idx;
    if (typeof idx === 'number' && Number.isFinite(idx)) return idx;
  }
  return 0;
}

function useHashHistoryNavAvailability() {
  const location = useLocation();
  const [maxIdx, setMaxIdx] = useState(() => readHistoryIdx());

  useLayoutEffect(() => {
    setMaxIdx((idx) => Math.max(idx, readHistoryIdx()));
  }, [location.key, location.pathname, location.search, location.hash]);

  useEffect(() => {
    const onPopState = () => setMaxIdx((idx) => Math.max(idx, readHistoryIdx()));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const idx = readHistoryIdx();
  return { canGoBack: idx > 0, canGoForward: idx < maxIdx };
}

export const ElectronHistoryNav = memo(function ElectronHistoryNav({
  className,
}: {
  className?: string;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const navigate = useNavigate();
  const { canGoBack, canGoForward } = useHashHistoryNavAvailability();

  if (!isElectron()) return null;

  return (
    <div className={cn('flex shrink-0 items-center gap-0.5', className)}>
      <Button
        type="button"
        variant="ghost"
        disabled={!canGoBack}
        className={cn('size-7 shrink-0 rounded-md p-0', APP_CHROME_NO_DRAG_CLASS)}
        title={m.historyBack}
        aria-label={m.historyBack}
        onClick={() => navigate(-1)}
      >
        <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={!canGoForward}
        className={cn('size-7 shrink-0 rounded-md p-0', APP_CHROME_NO_DRAG_CLASS)}
        title={m.historyForward}
        aria-label={m.historyForward}
        onClick={() => navigate(1)}
      >
        <ArrowRight className="size-4" strokeWidth={1.5} aria-hidden />
      </Button>
    </div>
  );
});
