import { ArrowLeft, ArrowRight } from 'lucide-react';
import { memo, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import {
  advanceElectronHistory,
  type ElectronHistorySnapshot,
} from '@/components/shell/electron-history-state';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { isElectron } from '@/lib/electron-env';
import { useLocaleStore } from '@/stores/locale-store';

let sharedHistorySnapshot: ElectronHistorySnapshot | undefined;

function useHashHistoryNavAvailability() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [snapshot, setSnapshot] = useState(() => {
    sharedHistorySnapshot = advanceElectronHistory(sharedHistorySnapshot, location.key, navigationType);
    return sharedHistorySnapshot;
  });

  useLayoutEffect(() => {
    sharedHistorySnapshot = advanceElectronHistory(sharedHistorySnapshot, location.key, navigationType);
    setSnapshot(sharedHistorySnapshot);
  }, [location.key, navigationType]);

  return {
    canGoBack: snapshot.index > 0,
    canGoForward: snapshot.index < snapshot.entries.length - 1,
  };
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
