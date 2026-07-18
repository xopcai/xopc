import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { isElectron } from '@/lib/electron-env';
import {
  defaultQuickCaptureShortcut,
  shortcutFromKeyboardEvent,
  useQuickCaptureShortcutStore,
} from '@/stores/quick-capture-shortcut-store';

type ShortcutEntry = {
  keys: string[];
  label: string;
  note?: string;
};

type ShortcutCategory = {
  title: string;
  shortcuts: ShortcutEntry[];
};

const isMac =
  typeof navigator !== 'undefined' &&
  (navigator.platform?.includes('Mac') ?? navigator.userAgent.includes('Mac'));

const MOD = isMac ? '⌘' : 'Ctrl';

function shortcutKeys(shortcut: string): string[] {
  return shortcut.split('+').map((key) => {
    if (key === 'control') return 'Ctrl';
    if (key === 'meta') return isMac ? '⌘' : 'Win';
    if (key === 'alt') return isMac ? 'Option' : 'Alt';
    if (key === 'shift') return 'Shift';
    if (key === 'space') return 'Space';
    return key.length === 1 ? key.toUpperCase() : key;
  });
}

function QuickCaptureShortcutEditor() {
  const language = useLocaleStore((s) => s.language);
  const k = messages(language).keyboardShortcutsSettings;
  const shortcut = useQuickCaptureShortcutStore((s) => s.shortcut);
  const setShortcut = useQuickCaptureShortcutStore((s) => s.setShortcut);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('quick-capture-shortcut-recording', { detail: { active: recording } }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent('quick-capture-shortcut-recording', { detail: { active: false } }),
      );
    };
  }, [recording]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      setRecording(false);
      return;
    }

    const next = shortcutFromKeyboardEvent(event.nativeEvent);
    if (!next) return;

    const modifier = isMac ? 'meta' : 'control';
    const reserved = new Set([
      `${modifier}+k`,
      `${modifier}+n`,
      `${modifier}+b`,
      `${modifier}+,`,
    ]);
    if (reserved.has(next)) {
      setError(k.quickCaptureShortcutConflict);
      return;
    }

    setShortcut(next);
    setError(null);
    setRecording(false);
  };

  return (
    <section className="rounded-xl bg-surface-base px-4 py-3.5 sm:px-5 sm:py-4" aria-label={k.quickCaptureShortcutTitle}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">{k.quickCaptureShortcutTitle}</h2>
          <p className="mt-1 text-sm text-fg-muted">{k.quickCaptureShortcutDescription}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {shortcutKeys(shortcut).map((key, index) => (
            <Kbd key={`${key}-${String(index)}`}>{key}</Kbd>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={cn(
            'rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent/90',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
          )}
          onClick={() => {
            setError(null);
            setRecording(true);
          }}
        >
          {k.quickCaptureShortcutChange}
        </button>
        <button
          type="button"
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={() => {
            setShortcut(defaultQuickCaptureShortcut());
            setError(null);
          }}
        >
          {k.quickCaptureShortcutReset}
        </button>
        {recording ? (
          <button
            type="button"
            autoFocus
            className="rounded-lg border border-accent bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent-fg outline-none"
            onKeyDown={onKeyDown}
            onClick={() => setRecording(false)}
          >
            {k.quickCaptureShortcutRecording}
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm text-danger-fg">{error}</p> : null}
    </section>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-edge-subtle bg-surface-hover/60 px-1.5 py-0.5 font-mono text-xs font-medium text-fg-muted shadow-[0_1px_0_0_var(--color-edge-subtle)]">
      {children}
    </kbd>
  );
}

function ShortcutRow({ keys, label, note }: ShortcutEntry) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <span className="text-sm text-fg">{label}</span>
        {note && <span className="ml-1.5 text-xs text-fg-muted">({note})</span>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </div>
    </div>
  );
}

function ShortcutSection({ title, shortcuts }: ShortcutCategory) {
  return (
    <section className={cn('rounded-xl bg-surface-base px-4 sm:px-5')} aria-label={title}>
      <h2 className="pb-1 pt-3.5 text-sm font-semibold text-fg sm:pt-4">{title}</h2>
      <div className="grid gap-1 pb-3 sm:pb-4">
        {shortcuts.map((s) => (
          <ShortcutRow key={s.label} {...s} />
        ))}
      </div>
    </section>
  );
}

export function KeyboardShortcutsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const k = m.keyboardShortcutsSettings;
  const quickCaptureShortcut = useQuickCaptureShortcutStore((s) => s.shortcut);

  const categories: ShortcutCategory[] = [];

  if (isElectron()) {
    categories.push({
      title: k.categoryGlobal,
      shortcuts: [
        { keys: [MOD, 'Shift', 'Space'], label: k.globalToggleWindow },
      ],
    });
  }

  categories.push({
    title: k.categoryNavigation,
    shortcuts: [
      { keys: [MOD, 'N'], label: k.globalNewChat },
      { keys: [MOD, 'K'], label: k.navCommandPalette },
      { keys: shortcutKeys(quickCaptureShortcut), label: k.navQuickCapture },
      ...(isElectron() ? [{ keys: [MOD, 'B'], label: k.navToggleSidebar }] : []),
      ...(isElectron() ? [{ keys: ['F11'], label: k.navToggleFullscreen }] : []),
      ...(isElectron() ? [{ keys: [MOD, ','], label: k.globalOpenSettings }] : []),
      { keys: ['Esc'], label: k.navCloseDialog },
    ],
  });

  categories.push({
    title: k.categoryChat,
    shortcuts: [
      { keys: ['Enter'], label: k.chatSend },
      { keys: ['Shift', 'Enter'], label: k.chatNewLine },
      { keys: [MOD, 'Enter'], label: k.chatForceSend },
    ],
  });

  categories.push({
    title: k.categoryEditor,
    shortcuts: [
      { keys: [MOD, 'Shift', '1'], label: k.editorHeading1 },
      { keys: [MOD, 'Shift', '2'], label: k.editorHeading2 },
      { keys: [MOD, 'Shift', '3'], label: k.editorHeading3 },
      { keys: [MOD, 'Shift', '8'], label: k.editorBulletList },
      { keys: [MOD, 'Shift', '9'], label: k.editorOrderedList },
      { keys: [MOD, 'Shift', '0'], label: k.editorTaskList },
    ],
  });

  return (
    <SettingsPageFrame gap="gap-6">
      <SettingsPageHeader title={k.pageTitle} subtitle={k.subtitle} />

      <QuickCaptureShortcutEditor />

      {categories.map((cat) => (
        <ShortcutSection key={cat.title} {...cat} />
      ))}
    </SettingsPageFrame>
  );
}
