import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, FolderInput, History } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';

import { SessionManager } from '@/features/chat/session-manager';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

const RECENT_DIRS_KEY = 'xopc.recentWorkspaceDirs.v1';
const MAX_RECENT = 10;

function readRecentDirs(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_DIRS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && x.trim()) : [];
  } catch {
    return [];
  }
}

function pushRecentDir(path: string): void {
  const t = path.trim();
  if (!t) return;
  try {
    const prev = readRecentDirs();
    const next = [t, ...prev.filter((p) => p !== t)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** Last path segment for display (folder name only). */
export function folderDisplayName(absPath: string): string {
  const t = absPath.trim().replace(/[/\\]+$/, '');
  if (!t) return absPath;
  const parts = t.split(/[/\\]/);
  return parts[parts.length - 1] || t;
}

type Props = {
  sessionKey: string | null;
  disabled: boolean;
  /** Only while the conversation has no messages yet (new chat start). */
  canSelectWorkingDirectory: boolean;
  sessionMgr: SessionManager;
};

export const SessionWorkingDirectoryControl = memo(function SessionWorkingDirectoryControl({
  sessionKey,
  disabled,
  canSelectWorkingDirectory,
  sessionMgr,
}: Props) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const wd = m.chat.workingDirectory;

  const [effectivePath, setEffectivePath] = useState('');
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [copiedFlash, setCopiedFlash] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionKey) {
      setEffectivePath('');
      setLocked(false);
      return;
    }
    setLoading(true);
    try {
      const cfg = await sessionMgr.loadSessionAgentConfig(sessionKey);
      setEffectivePath(cfg.effectiveWorkspacePath);
      setLocked(cfg.workingDirectoryLocked);
    } catch {
      setEffectivePath('');
      setLocked(false);
    } finally {
      setLoading(false);
    }
  }, [sessionKey, sessionMgr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setRecent(readRecentDirs());
  }, [sessionKey, locked]);

  const applyPath = useCallback(
    async (path: string) => {
      if (!sessionKey?.trim() || !path.trim()) return;
      try {
        await sessionMgr.patchSessionAgentConfig(sessionKey, { workingDirectory: path.trim() });
        pushRecentDir(path.trim());
        setRecent(readRecentDirs());
        await refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        window.alert(msg);
      }
    },
    [sessionKey, sessionMgr, refresh],
  );

  /** Native folder dialog (Electron). Web build has no host path — prompt is not used for primary flow. */
  const openFolderPicker = useCallback(async (): Promise<string | null> => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.file?.openDirectory : undefined;
    if (api) {
      return api();
    }
    window.alert(wd.folderPickerRequiresDesktop);
    return null;
  }, [wd.folderPickerRequiresDesktop]);

  const onSelectFolderFromMenu = useCallback(async () => {
    const picked = await openFolderPicker();
    if (picked) await applyPath(picked);
  }, [applyPath, openFolderPicker]);

  const onPickRecent = useCallback(
    async (p: string) => {
      await applyPath(p);
    },
    [applyPath],
  );

  const copyFullPath = useCallback(async () => {
    const full = effectivePath.trim();
    if (!full) return;
    try {
      await navigator.clipboard.writeText(full);
      setCopiedFlash(true);
      window.setTimeout(() => setCopiedFlash(false), 2000);
    } catch {
      /* ignore */
    }
  }, [effectivePath]);

  if (!sessionKey) {
    return null;
  }

  const fullPath = effectivePath.trim();
  const hasPath = Boolean(fullPath);
  const label = hasPath ? folderDisplayName(fullPath) : wd.notSet;
  const titleForCopy =
    hasPath && fullPath
      ? `${fullPath}\n${wd.clickToCopyFullPath}`
      : wd.selectWorkingDirectory;

  const chipClass = cn(
    'inline-flex min-h-8 max-w-[min(12rem,40vw)] min-w-0 shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs',
    hasPath && 'cursor-pointer hover:bg-surface-hover/70 dark:hover:bg-surface-hover/50',
    !hasPath && 'cursor-default text-fg-muted',
    'border border-edge-subtle/80 bg-surface-hover/40 dark:border-edge-subtle',
    interaction.transition,
    interaction.focusRingPanel,
    copiedFlash && 'ring-1 ring-accent/60',
  );

  const mainChip = (
    <button
      type="button"
      disabled={disabled || loading || !hasPath}
      className={chipClass}
      title={titleForCopy}
      onClick={(e) => {
        e.stopPropagation();
        if (hasPath && !disabled && !loading) void copyFullPath();
      }}
    >
      <FolderInput className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
      <span className="min-w-0 truncate text-left font-medium text-fg">{label}</span>
      {copiedFlash ? (
        <span className="shrink-0 text-[10px] text-accent">{wd.copied}</span>
      ) : null}
    </button>
  );

  if (locked) {
    return (
      <div className="inline-flex items-center gap-0.5">
        <button
          type="button"
          disabled={!hasPath}
          className={chipClass}
          title={hasPath ? titleForCopy : fullPath}
          onClick={() => {
            if (hasPath) void copyFullPath();
          }}
        >
          <FolderInput className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
          <span className="min-w-0 truncate text-left font-medium text-fg">{label}</span>
          {copiedFlash ? (
            <span className="shrink-0 text-[10px] text-accent">{wd.copied}</span>
          ) : null}
        </button>
      </div>
    );
  }

  if (!canSelectWorkingDirectory) {
    return (
      <div className="inline-flex items-center gap-0.5">
        <button
          type="button"
          disabled={!hasPath}
          className={chipClass}
          title={hasPath ? titleForCopy : `${wd.notSet}\n${wd.selectionOnlyAtNewChat}`}
          onClick={() => {
            if (hasPath) void copyFullPath();
          }}
        >
          <FolderInput className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
          <span className="min-w-0 truncate text-left font-medium text-fg">{label}</span>
          {copiedFlash ? (
            <span className="shrink-0 text-[10px] text-accent">{wd.copied}</span>
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-0.5">
      {mainChip}

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            disabled={disabled || loading}
            className={cn(
              'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-edge-subtle/80 bg-surface-hover/40 text-fg-muted hover:bg-surface-hover/70 dark:border-edge-subtle',
              interaction.transition,
              interaction.press,
              interaction.focusRingPanel,
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
            title={wd.openWorkspaceMenu}
            aria-label={wd.openWorkspaceMenu}
          >
            <ChevronDown className="size-4" aria-hidden />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="z-[80] min-w-[12rem] rounded-lg border border-edge bg-surface-panel p-1 text-sm shadow-popover dark:border-edge"
            sideOffset={4}
            align="start"
          >
            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-fg outline-none hover:bg-surface-hover data-[highlighted]:bg-surface-hover"
              onSelect={(e) => {
                e.preventDefault();
                void onSelectFolderFromMenu();
              }}
            >
              <FolderInput className="size-4 shrink-0 text-fg-muted" aria-hidden />
              {wd.selectPath}
            </DropdownMenu.Item>

            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-fg outline-none hover:bg-surface-hover data-[highlighted]:bg-surface-hover data-[state=open]:bg-surface-hover">
                <History className="size-4 shrink-0 text-fg-muted" aria-hidden />
                {wd.recentDirectories}
                <span className="ml-auto text-fg-muted">›</span>
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  className="z-[90] min-w-[14rem] max-w-[min(24rem,90vw)] rounded-lg border border-edge bg-surface-panel p-1 text-sm shadow-popover dark:border-edge"
                  sideOffset={6}
                >
                  {recent.length === 0 ? (
                    <div className="px-2 py-2 text-xs text-fg-muted">{wd.noRecent}</div>
                  ) : (
                    recent.map((p) => (
                      <DropdownMenu.Item
                        key={p}
                        className="max-w-full cursor-pointer truncate rounded-md px-2 py-1.5 text-fg outline-none hover:bg-surface-hover data-[highlighted]:bg-surface-hover"
                        title={p}
                        onSelect={(e) => {
                          e.preventDefault();
                          void onPickRecent(p);
                        }}
                      >
                        {folderDisplayName(p)}
                      </DropdownMenu.Item>
                    ))
                  )}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
});
