import {
  formControlBorderFocusClass,
  nativeSelectMaxWidthClass,
  selectControlBaseClass,
} from '@/lib/form-field-width';
import { cn } from '@/lib/cn';

export const RUN_HISTORY_FETCH_LIMIT = 400;

export const DEFAULT_SCHEDULE = '*/5 * * * *';

/** Same storage key as chat composer so recent folders stay in sync. */
export const RECENT_WD_STORAGE_KEY = 'xopc.recentWorkspaceDirs.v1';
export const RECENT_WD_MAX = 10;

export function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Week starts on Monday (local). */
export function startOfLocalWeekMonday(d: Date): Date {
  const x = startOfLocalDay(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

export function startOfLocalMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

export function navigateToSessionChat(sessionKey: string | undefined | null): void {
  const sk = sessionKey?.trim();
  if (!sk) return;
  window.dispatchEvent(
    new CustomEvent('navigate-to-chat', { detail: { sessionKey: sk }, bubbles: true }),
  );
}

export function pushRecentWorkspaceDirForCron(path: string): void {
  const t = path.trim();
  if (!t) return;
  try {
    const raw = localStorage.getItem(RECENT_WD_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const prev = Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
    const next = [t, ...prev.filter((p) => p !== t)].slice(0, RECENT_WD_MAX);
    localStorage.setItem(RECENT_WD_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function inputClassName(disabled?: boolean): string {
  return cn(
    'w-full rounded-md border border-edge bg-surface-base px-3 py-2 text-sm text-fg placeholder:text-fg-disabled',
    formControlBorderFocusClass,
    disabled && 'cursor-not-allowed opacity-60',
  );
}

export function selectClassName(): string {
  return cn(selectControlBaseClass, nativeSelectMaxWidthClass);
}

export const cronRecipientSelectClass = cn(
  selectControlBaseClass,
  'w-full text-xs sm:w-auto sm:min-w-[11rem] sm:max-w-[17rem] sm:shrink-0',
);

/** Toolbar filters: avoid `w-full` from {@link nativeSelectMaxWidthClass} so Day/Week/Month + selects stay one row. */
export const cronToolbarSelectClass = cn(
  selectControlBaseClass,
  'w-auto min-w-[9rem] max-w-[14rem] shrink-0 text-xs',
);
