import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AppWindow, Check, ChevronDown, ExternalLink, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';

export type OpenWithApp = { name: string; path: string; iconDataUrl?: string };
export type ChooseAppAction = { onClick: () => void | OpenWithApp | Promise<void | OpenWithApp>; disabled?: boolean; loading?: boolean };
type OpenAction = { onClick: () => void; disabled?: boolean; loading?: boolean };

type FileOpenMenuProps = {
  systemApp?: OpenAction;
  chooseApp?: ChooseAppAction;
  recommendedApps: OpenWithApp[];
  recentApps: OpenWithApp[];
  onOpenWithApp?: (path: string) => void;
};

function ApplicationIcon({ app }: { app?: OpenWithApp }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return app?.iconDataUrl && app.iconDataUrl !== failedUrl
    ? <img src={app.iconDataUrl} alt="" width={20} height={20} className="size-5 shrink-0 object-contain" onError={() => setFailedUrl(app.iconDataUrl)} />
    : <AppWindow className="size-5 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />;
}

/** Keep the selected application and its open action together in a split button. */
export function FileOpenMenu({ systemApp, chooseApp, recommendedApps, recentApps, onOpenWithApp }: FileOpenMenuProps) {
  const language = useLocaleStore((state) => state.language);
  const m = messages(language).workspace;
  // undefined follows the first suggestion; null explicitly uses the system default.
  const [selection, setSelection] = useState<OpenWithApp | null>();
  const [choosing, setChoosing] = useState(false);
  const apps = [...recommendedApps, ...recentApps];
  const selectedApp = onOpenWithApp && selection !== null
    ? apps.find((app) => app.path === selection?.path) ?? selection ?? apps[0] : undefined;
  const busy = Boolean(choosing || systemApp?.loading || chooseApp?.loading);
  const disabled = busy || Boolean(systemApp?.disabled);
  const openLabel = selectedApp ? (language === 'zh' ? `用 ${selectedApp.name} 打开` : `Open with ${selectedApp.name}`) : m.openSystemApp;
  const itemClass = 'flex min-h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-40';
  const separatorClass = 'my-1 h-px bg-edge-subtle';

  if (!systemApp && !chooseApp && (!onOpenWithApp || !apps.length)) return null;

  return <div className="inline-flex h-9 shrink-0 items-stretch rounded-full border border-edge-subtle bg-surface-panel">
    <button type="button" aria-label={openLabel} title={openLabel}
      disabled={disabled || (!selectedApp && !systemApp)}
      onClick={() => selectedApp ? onOpenWithApp?.(selectedApp.path) : systemApp?.onClick()}
      className={cn('inline-flex min-w-0 items-center gap-2 rounded-l-full pl-3 pr-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40', interaction.focusRingPanel)}>
      {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ApplicationIcon app={selectedApp} />}
      <span>{language === 'zh' ? '打开' : 'Open'}</span>
    </button>
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={m.chooseApp} title={m.chooseApp} disabled={disabled}
          className={cn('inline-flex w-8 shrink-0 items-center justify-center rounded-r-full text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40', interaction.focusRingPanel)}>
          <ChevronDown className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} collisionPadding={8} aria-label={m.chooseApp} onEscapeKeyDown={(event) => event.stopPropagation()}
          className="z-[150] max-h-[var(--radix-dropdown-menu-content-available-height)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-xl border border-edge bg-surface-overlay p-1 shadow-popover outline-none">
          {systemApp ? <DropdownMenu.Item className={itemClass} disabled={systemApp.disabled || busy}
            onSelect={() => { setSelection(null); systemApp.onClick(); }}>
            <ExternalLink className="size-5 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{m.openSystemApp}</span>
            {!selectedApp ? <Check className="size-4 shrink-0" aria-hidden /> : null}
          </DropdownMenu.Item> : null}
          {onOpenWithApp ? [
            { label: m.recommendedApps, apps: recommendedApps },
            { label: m.recentApps, apps: recentApps.filter((app) => !recommendedApps.some((candidate) => candidate.path === app.path)) },
          ].map((group) => group.apps.length ? <DropdownMenu.Group key={group.label}>
            <DropdownMenu.Separator className={separatorClass} />
            <DropdownMenu.Label className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-fg-muted">{group.label}</DropdownMenu.Label>
            {group.apps.map((app) => <DropdownMenu.Item key={app.path} className={itemClass} disabled={busy} title={app.name}
              onSelect={() => { setSelection(app); onOpenWithApp(app.path); }}>
              <ApplicationIcon app={app} />
              <span className="min-w-0 flex-1 truncate">{app.name}</span>
              {app.path === selectedApp?.path ? <Check className="size-4 shrink-0" aria-hidden /> : null}
            </DropdownMenu.Item>)}
          </DropdownMenu.Group> : null) : null}
          {chooseApp ? <>
            <DropdownMenu.Separator className={separatorClass} />
            <DropdownMenu.Item className={itemClass} disabled={chooseApp.disabled || busy} onSelect={async () => {
              setChoosing(true);
              try {
                const app = await chooseApp.onClick();
                if (app) setSelection(app);
              } finally { setChoosing(false); }
            }}>
              <AppWindow className="size-5 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 truncate">{m.chooseApp}</span>
            </DropdownMenu.Item>
          </> : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  </div>;
}
