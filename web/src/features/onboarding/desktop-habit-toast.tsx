import { Command, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { isElectron } from '@/lib/electron-env';
import { isElectronDarwin } from '@/lib/electron-window-chrome';
import { useLocaleStore } from '@/stores/locale-store';

const HABIT_PENDING_KEY = 'xopc-desktop-habit-anchor-pending';
const HABIT_SHOWN_KEY = 'xopc-desktop-habit-anchor-shown';

export function markDesktopHabitAnchorPending(): void {
  try {
    if (localStorage.getItem(HABIT_SHOWN_KEY) === '1') return;
    sessionStorage.setItem(HABIT_PENDING_KEY, '1');
  } catch {
    // Ignore storage failures in restricted modes.
  }
}

function consumePendingHabitAnchor(): boolean {
  try {
    if (localStorage.getItem(HABIT_SHOWN_KEY) === '1') return false;
    if (sessionStorage.getItem(HABIT_PENDING_KEY) !== '1') return false;
    sessionStorage.removeItem(HABIT_PENDING_KEY);
    localStorage.setItem(HABIT_SHOWN_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * One-time calm habit anchor shown briefly after completing Electron first-run onboarding.
 * Anchors the primary keyboard shortcut (`⌘K` / `Ctrl+K`) and disappears automatically.
 */
export function DesktopHabitToast() {
  const language = useLocaleStore((s) => s.language);
  const zh = language === 'zh';
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isElectron()) return;
    if (!consumePendingHabitAnchor()) return;

    const showTimer = window.setTimeout(() => setVisible(true), 1_100);
    const hideTimer = window.setTimeout(() => setVisible(false), 10_500);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
        setVisible(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  if (!visible) return null;

  const mac = isElectronDarwin();
  const shortcut = mac ? '⌘K' : 'Ctrl+K';

  return (
    <div
      role="status"
      aria-live="polite"
      className="xopc-focus-stage fixed bottom-5 right-5 z-[52] flex max-w-sm items-center gap-3 rounded-2xl border border-edge bg-surface-overlay/95 px-4 py-3 text-fg shadow-elevated backdrop-blur-md"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-fg" aria-hidden>
        <Command className="size-4" />
      </span>
      <p className="min-w-0 flex-1 text-xs leading-5 text-fg-muted">
        {zh ? (
          <>
            随时按 <kbd className="rounded border border-edge bg-surface-inset px-1.5 py-0.5 font-mono text-[11px] font-medium text-fg">{shortcut}</kbd> 快速搜索、新建任务或切换工作
          </>
        ) : (
          <>
            Press <kbd className="rounded border border-edge bg-surface-inset px-1.5 py-0.5 font-mono text-[11px] font-medium text-fg">{shortcut}</kbd> anytime to search or jump into work
          </>
        )}
      </p>
      <button
        type="button"
        aria-label={zh ? '关闭提示' : 'Dismiss tip'}
        onClick={() => setVisible(false)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
