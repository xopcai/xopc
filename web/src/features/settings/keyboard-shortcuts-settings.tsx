import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { isElectron } from '@/lib/electron-env';
import { APP_SHORTCUT_RECORDING_EVENT } from '@/features/voice/voice-input-shortcut-events';
import {
  defaultQuickCaptureShortcut,
  isMacPlatform,
  shortcutDisplayKeys,
  shortcutFromKeyboardEvent,
  useQuickCaptureShortcutStore,
} from '@/stores/quick-capture-shortcut-store';
import {
  defaultVoiceInputShortcut,
  useVoiceInputShortcutStore,
} from '@/stores/voice-input-shortcut-store';

type ShortcutEntry = {
  keys: string[];
  label: string;
  note?: string;
};

type ShortcutCategory = {
  title: string;
  shortcuts: ShortcutEntry[];
};

const isMac = isMacPlatform();

const MOD = isMac ? '⌘' : 'Ctrl';

function ShortcutEditor({
  title,
  description,
  shortcut,
  otherShortcut,
  defaultShortcut,
  setShortcut,
  legacyRecordingEvent,
  notice,
}: {
  title: string;
  description: string;
  shortcut: string;
  otherShortcut: string;
  defaultShortcut: () => string;
  setShortcut: (shortcut: string) => void;
  legacyRecordingEvent?: string;
  notice?: ReactNode;
}) {
  const language = useLocaleStore((s) => s.language);
  const k = messages(language).keyboardShortcutsSettings;
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const detail = { active: recording };
    window.dispatchEvent(new CustomEvent(APP_SHORTCUT_RECORDING_EVENT, { detail }));
    if (legacyRecordingEvent) window.dispatchEvent(new CustomEvent(legacyRecordingEvent, { detail }));
    return () => {
      const inactive = { active: false };
      window.dispatchEvent(new CustomEvent(APP_SHORTCUT_RECORDING_EVENT, { detail: inactive }));
      if (legacyRecordingEvent) window.dispatchEvent(new CustomEvent(legacyRecordingEvent, { detail: inactive }));
    };
  }, [legacyRecordingEvent, recording]);

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
    if (reserved.has(next) || next === otherShortcut) {
      setError(k.quickCaptureShortcutConflict);
      return;
    }

    setShortcut(next);
    setError(null);
    setRecording(false);
  };

  return (
    <section className="rounded-xl bg-surface-base px-4 py-3.5 sm:px-5 sm:py-4" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          <p className="mt-1 text-sm text-fg-muted">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {shortcutDisplayKeys(shortcut).map((key, index) => (
            <Kbd key={`${key}-${String(index)}`}>{key}</Kbd>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={cn(
            'rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover',
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
            setShortcut(defaultShortcut());
            setError(null);
          }}
        >
          {k.quickCaptureShortcutReset}
        </button>
        {recording ? (
          <button
            type="button"
            className="rounded-lg border border-accent bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent-fg outline-none"
            onKeyDown={onKeyDown}
            onClick={() => setRecording(false)}
          >
            {k.quickCaptureShortcutRecording}
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm text-danger-fg">{error}</p> : null}
      {notice ? <div className="mt-3 border-t border-edge pt-3">{notice}</div> : null}
    </section>
  );
}

function QuickCaptureShortcutEditor() {
  const language = useLocaleStore((s) => s.language);
  const k = messages(language).keyboardShortcutsSettings;
  const shortcut = useQuickCaptureShortcutStore((s) => s.shortcut);
  const setShortcut = useQuickCaptureShortcutStore((s) => s.setShortcut);
  const voiceShortcut = useVoiceInputShortcutStore((s) => s.shortcut);
  return (
    <ShortcutEditor
      title={k.quickCaptureShortcutTitle}
      description={k.quickCaptureShortcutDescription}
      shortcut={shortcut}
      otherShortcut={voiceShortcut}
      defaultShortcut={defaultQuickCaptureShortcut}
      setShortcut={setShortcut}
      legacyRecordingEvent="quick-capture-shortcut-recording"
    />
  );
}

function VoiceInputShortcutEditor() {
  const language = useLocaleStore((s) => s.language);
  const k = messages(language).keyboardShortcutsSettings;
  const shortcut = useVoiceInputShortcutStore((s) => s.shortcut);
  const setShortcut = useVoiceInputShortcutStore((s) => s.setShortcut);
  const quickCaptureShortcut = useQuickCaptureShortcutStore((s) => s.shortcut);
  return (
    <ShortcutEditor
      title={k.voiceInputShortcutTitle}
      description={k.voiceInputShortcutDescription}
      shortcut={shortcut}
      otherShortcut={quickCaptureShortcut}
      defaultShortcut={defaultVoiceInputShortcut}
      setShortcut={setShortcut}
      notice={<MacVoiceHotkeyPermissionNotice />}
    />
  );
}

function MacVoiceHotkeyPermissionNotice() {
  const language = useLocaleStore((s) => s.language);
  const k = messages(language).keyboardShortcutsSettings;
  const system = window.electronAPI?.system;
  const isMacElectron = isElectron() && window.electronAPI?.platform === 'darwin';
  const [granted, setGranted] = useState(false);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (!isMacElectron || !system) return;
    let active = true;
    const refresh = () => {
      void system.getPermissions().then((permissions) => {
        if (active) setGranted(permissions.accessibility === 'granted');
      }).catch(() => undefined);
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [isMacElectron, system]);

  if (!isMacElectron || !system) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="max-w-[65ch] text-xs text-fg-muted">
        {granted ? k.voiceInputAccessibilityGranted : k.voiceInputAccessibilityDescription}
      </p>
      {!granted ? (
        <button
          type="button"
          disabled={requesting}
          className={cn(
            'rounded-lg border border-edge-strong bg-surface-panel px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-surface-hover',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:text-fg-disabled',
          )}
          onClick={async () => {
            setRequesting(true);
            try {
              const result = await system.requestAccessibility();
              setGranted(result.status === 'granted');
            } finally {
              setRequesting(false);
            }
          }}
        >
          {requesting ? k.voiceInputAccessibilityRequesting : k.voiceInputAccessibilityEnable}
        </button>
      ) : null}
    </div>
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
  const voiceInputShortcut = useVoiceInputShortcutStore((s) => s.shortcut);

  const categories: ShortcutCategory[] = [];

  if (isElectron()) {
    const voiceModifier = window.electronAPI?.platform === 'darwin' ? 'Fn' : 'Alt';
    const voiceModifierNote = window.electronAPI?.platform === 'darwin'
      ? k.globalVoiceInputMacNote
      : k.globalVoiceInputWindowsNote;
    categories.push({
      title: k.categoryGlobal,
      shortcuts: [
        { keys: [MOD, 'Shift', 'Space'], label: k.globalToggleWindow },
        { keys: [voiceModifier], label: k.globalVoiceInput, note: voiceModifierNote },
      ],
    });
  }

  categories.push({
    title: k.categoryNavigation,
    shortcuts: [
      { keys: [MOD, 'N'], label: k.globalNewChat },
      { keys: [MOD, 'K'], label: k.navCommandPalette },
      { keys: shortcutDisplayKeys(quickCaptureShortcut), label: k.navQuickCapture },
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
      { keys: shortcutDisplayKeys(voiceInputShortcut), label: k.chatVoiceInput },
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
      <VoiceInputShortcutEditor />

      {categories.map((cat) => (
        <ShortcutSection key={cat.title} {...cat} />
      ))}
    </SettingsPageFrame>
  );
}
