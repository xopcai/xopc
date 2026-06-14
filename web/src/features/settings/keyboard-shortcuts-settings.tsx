import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { isElectron } from '@/lib/electron-env';

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
    <section
      className={cn('rounded-xl border border-edge-subtle bg-surface-base px-4 sm:px-5')}
      aria-label={title}
    >
      <h2 className="pb-1 pt-3.5 text-sm font-semibold text-fg sm:pt-4">{title}</h2>
      <div className="divide-y divide-edge-subtle">
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

  const categories: ShortcutCategory[] = [];

  if (isElectron()) {
    categories.push({
      title: k.categoryGlobal,
      shortcuts: [
        { keys: [MOD, 'Shift', 'Space'], label: k.globalToggleWindow },
        { keys: [MOD, ','], label: k.globalOpenSettings },
        { keys: [MOD, 'N'], label: k.globalNewChat },
        { keys: [MOD, 'K'], label: k.globalCommandPalette },
      ],
    });
  }

  categories.push({
    title: k.categoryNavigation,
    shortcuts: [
      { keys: [MOD, 'K'], label: k.navCommandPalette },
      { keys: [MOD, '.'], label: k.navQuickCapture },
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
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{k.pageTitle}</h1>
        <p className="text-sm text-fg-muted">{k.subtitle}</p>
      </header>

      {categories.map((cat) => (
        <ShortcutSection key={cat.title} {...cat} />
      ))}
    </div>
  );
}
