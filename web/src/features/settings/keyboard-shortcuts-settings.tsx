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
  shortcutFromPhysicalKeyboardEvent,
  useQuickCaptureShortcutStore,
} from '@/stores/quick-capture-shortcut-store';
import {
  defaultVoiceInputShortcut,
  useVoiceInputShortcutStore,
} from '@/stores/voice-input-shortcut-store';
import { sideChatShortcutKeys } from '@/features/side-chat/side-chat-shortcut';

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
  otherShortcuts,
  defaultShortcut,
  setShortcut,
  notice,
  screenshotShortcut,
  capturePhysicalKey = false,
}: {
  title: string;
  description: string;
  shortcut: string;
  otherShortcuts: string[];
  defaultShortcut: () => string;
  setShortcut: (shortcut: string) => void | Promise<'ok' | 'invalid' | 'conflict' | 'saveFailed'>;
  notice?: ReactNode;
  screenshotShortcut?: NonNullable<Window['electronAPI']>['screenshotShortcut'];
  capturePhysicalKey?: boolean;
}) {
  const language = useLocaleStore((s) => s.language);
  const k = messages(language).keyboardShortcutsSettings;
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!recording) return;
    window.dispatchEvent(new CustomEvent(APP_SHORTCUT_RECORDING_EVENT, { detail: { active: true } }));
    void screenshotShortcut?.setRecording(true).catch(() => undefined);
    return () => {
      window.dispatchEvent(new CustomEvent(APP_SHORTCUT_RECORDING_EVENT, { detail: { active: false } }));
      void screenshotShortcut?.setRecording(false).catch(() => undefined);
    };
  }, [recording, screenshotShortcut]);

  const applyShortcut = async (next: string) => {
    const modifier = isMac ? 'meta' : 'control';
    const reserved = [`${modifier}+k`, `${modifier}+n`, `${modifier}+b`, `${modifier}+,`];
    if (reserved.includes(next) || otherShortcuts.includes(next)) {
      setError(k.quickCaptureShortcutConflict);
      return;
    }

    setError(null);
    setRecording(false);
    setSaving(true);
    try {
      const result = await setShortcut(next);
      if (result === 'conflict') setError(k.quickCaptureShortcutConflict);
      if (result === 'invalid') {
        setError(isMac ? k.screenshotShortcutInvalid : k.screenshotShortcutInvalidDesktop);
      }
      if (result === 'saveFailed') setError(k.screenshotShortcutSaveFailed);
    } catch {
      setError(k.screenshotShortcutSaveFailed);
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      setRecording(false);
      return;
    }
    if (event.repeat) return;

    const next = (capturePhysicalKey ? shortcutFromPhysicalKeyboardEvent : shortcutFromKeyboardEvent)(event.nativeEvent);
    if (next) void applyShortcut(next);
  };

  return (
    <section className="rounded-xl bg-surface-hover/20 px-4 py-3.5 sm:px-5 sm:py-4" aria-label={title}>
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
            'rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
          )}
          disabled={saving}
          onClick={() => {
            setError(null);
            setRecording(!recording);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setRecording(false)}
        >
          {recording ? k.quickCaptureShortcutRecording : k.quickCaptureShortcutChange}
        </button>
        <button
          type="button"
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          disabled={saving}
          onClick={() => void applyShortcut(defaultShortcut())}
        >
          {k.quickCaptureShortcutReset}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-danger-fg">{error}</p> : null}
      {notice ? <div className="mt-3 rounded-lg bg-surface-base/55 p-3">{notice}</div> : null}
    </section>
  );
}

type ScreenshotShortcutProps = {
  screenshot?: string;
  screenshotShortcut?: NonNullable<Window['electronAPI']>['screenshotShortcut'];
};

function QuickCaptureShortcutEditor({ screenshot, screenshotShortcut }: ScreenshotShortcutProps) {
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
      otherShortcuts={screenshot ? [voiceShortcut, screenshot] : [voiceShortcut]}
      screenshotShortcut={screenshotShortcut}
      defaultShortcut={defaultQuickCaptureShortcut}
      setShortcut={setShortcut}
    />
  );
}

function VoiceInputShortcutEditor({ screenshot, screenshotShortcut }: ScreenshotShortcutProps) {
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
      otherShortcuts={screenshot ? [quickCaptureShortcut, screenshot] : [quickCaptureShortcut]}
      screenshotShortcut={screenshotShortcut}
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
            'rounded-lg bg-surface-base/70 px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-surface-hover',
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
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md bg-surface-hover/70 px-1.5 py-0.5 font-mono text-xs font-medium text-fg-muted shadow-sm">
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
    <section className={cn('rounded-xl bg-surface-hover/20 px-4 sm:px-5')} aria-label={title}>
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
  const modifier = isMac ? 'meta' : 'control';

  const screenshotShortcut = window.electronAPI?.screenshotShortcut;
  const screenshotApi = window.electronAPI?.screenshot;
  const [screenshot, setScreenshot] = useState<Awaited<ReturnType<NonNullable<typeof screenshotShortcut>['get']>>>();
  const [hideMainWindow, setHideMainWindow] = useState(false);

  useEffect(() => {
    let active = true;
    void screenshotShortcut?.get().then((result) => {
      if (active) setScreenshot(result);
    }).catch(() => undefined);
    void screenshotApi?.getPreferences().then((prefs) => {
      if (active) setHideMainWindow(prefs.hideMainWindow);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [screenshotApi, screenshotShortcut]);

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
      { keys: ['Alt', 'Enter'], label: k.chatSteer },
      { keys: [MOD, 'Enter'], label: k.chatSteerFirst },
      { keys: shortcutDisplayKeys(voiceInputShortcut), label: k.chatVoiceInput },
      { keys: sideChatShortcutKeys(window.electronAPI?.platform), label: k.chatToggleSideChat },
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

      {screenshot && screenshotShortcut ? (
        <ShortcutEditor
          title={k.screenshotShortcutTitle}
          description={k.screenshotShortcutDescription}
          shortcut={screenshot.shortcut}
          otherShortcuts={[
            quickCaptureShortcut, voiceInputShortcut, `${modifier}+shift+b`,
            ...['0', '1', '2', '3', '8', '9'].map((key) => `${modifier}+shift+${key}`),
          ]}
          capturePhysicalKey
          defaultShortcut={() => screenshot.defaultShortcut}
          screenshotShortcut={screenshotShortcut}
          setShortcut={async (next) => {
            const result = await screenshotShortcut.set(next);
            if (result === 'ok') setScreenshot(await screenshotShortcut.get());
            return result;
          }}
          notice={(
            <div className="space-y-2.5">
              {!screenshot.registered ? (
                <div className="space-y-1">
                  <p className="text-xs text-fg-muted">{k.screenshotShortcutUnavailable}</p>
                  {window.electronAPI?.platform === 'linux' ? (
                    <p className="text-xs text-fg-muted">{k.screenshotWaylandCliHint}</p>
                  ) : null}
                </div>
              ) : null}
              {screenshotApi ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex cursor-pointer items-start gap-2.5 text-xs text-fg">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-edge accent-accent"
                      checked={hideMainWindow}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setHideMainWindow(checked);
                        void screenshotApi.setPreferences({ hideMainWindow: checked }).catch(() => undefined);
                      }}
                    />
                    <span>
                      <span className="block font-medium text-fg">{k.screenshotHideMainWindow}</span>
                      <span className="block text-fg-muted">{k.screenshotHideMainWindowHint}</span>
                    </span>
                  </label>
                  <button
                    type="button"
                    className={cn(
                      'rounded-lg bg-surface-base/70 px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-surface-hover',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    )}
                    onClick={() => {
                      void screenshotApi.start();
                    }}
                  >
                    {k.screenshotTakeNow}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        />
      ) : null}
      <QuickCaptureShortcutEditor screenshot={screenshot?.shortcut} screenshotShortcut={screenshotShortcut} />
      <VoiceInputShortcutEditor screenshot={screenshot?.shortcut} screenshotShortcut={screenshotShortcut} />

      {categories.map((cat) => (
        <ShortcutSection key={cat.title} {...cat} />
      ))}
    </SettingsPageFrame>
  );
}
