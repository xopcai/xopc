import { FolderInput } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';

import { SessionManager } from '@/features/chat/session-manager';
import { WorkingDirectoryPickerModal } from '@/features/chat/working-directory-picker-modal';
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
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
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
  const [loading, setLoading] = useState(false);
  const [pathModalOpen, setPathModalOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionKey) {
      setEffectivePath('');
      return;
    }
    setLoading(true);
    try {
      const cfg = await sessionMgr.loadSessionAgentConfig(sessionKey);
      setEffectivePath(cfg.effectiveWorkspacePath);
    } catch {
      setEffectivePath('');
    } finally {
      setLoading(false);
    }
  }, [sessionKey, sessionMgr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyPath = useCallback(
    async (path: string) => {
      if (!sessionKey?.trim() || !path.trim()) return;
      try {
        await sessionMgr.patchSessionAgentConfig(sessionKey, { workingDirectory: path.trim() });
        pushRecentDir(path.trim());
        await refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        window.alert(msg);
        throw e;
      }
    },
    [sessionKey, sessionMgr, refresh],
  );

  /** Native folder dialog — only available in Electron desktop build. */
  const openNativeFolderPicker = useCallback(async (): Promise<string | null> => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.file?.openDirectory : undefined;
    if (api) return api();
    return null;
  }, []);

  const hasElectronFolderPicker =
    typeof window !== 'undefined' && Boolean(window.electronAPI?.file?.openDirectory);

  const onSelectWorkingDirectoryClick = useCallback(() => {
    if (hasElectronFolderPicker) {
      void (async () => {
        const picked = await openNativeFolderPicker();
        if (picked) await applyPath(picked);
      })();
    } else {
      setPathModalOpen(true);
    }
  }, [applyPath, hasElectronFolderPicker, openNativeFolderPicker]);

  const copyFullPath = useCallback(async () => {
    const full = effectivePath.trim();
    if (!full) return;
    try {
      await navigator.clipboard.writeText(full);
      window.dispatchEvent(
        new CustomEvent('extension-notification', {
          detail: { type: 'success' as const, title: wd.copied, duration: 2500 },
        }),
      );
    } catch {
      /* ignore */
    }
  }, [effectivePath, wd.copied]);

  if (!sessionKey) {
    return null;
  }

  const fullPath = effectivePath.trim();
  const hasPath = Boolean(fullPath);
  const label = hasPath ? folderDisplayName(fullPath) : wd.notSet;

  const chipClass = cn(
    'inline-flex min-h-8 max-w-[min(12rem,40vw)] min-w-0 shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs',
    'border border-edge-subtle/80 bg-surface-hover/40 dark:border-edge-subtle',
    interaction.transition,
    interaction.focusRingPanel,
  );

  const readOnlyChip = (title: string) => (
    <div
      className={cn(chipClass, !hasPath && 'cursor-default text-fg-muted')}
      title={title}
    >
      <FolderInput className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
      <span className="min-w-0 truncate text-left font-medium text-fg">{label}</span>
    </div>
  );

  const copyPathChip = (title: string) => (
    <button
      type="button"
      disabled={disabled || loading || !hasPath}
      className={cn(
        chipClass,
        hasPath && 'cursor-pointer hover:bg-surface-hover/70 dark:hover:bg-surface-hover/50',
        (disabled || loading || !hasPath) && 'cursor-not-allowed opacity-60',
      )}
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        if (hasPath && !disabled && !loading) void copyFullPath();
      }}
    >
      <FolderInput className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
      <span className="min-w-0 truncate text-left font-medium text-fg">{label}</span>
    </button>
  );

  if (!canSelectWorkingDirectory) {
    if (!hasPath) {
      return (
        <div className="inline-flex items-center">
          {readOnlyChip(`${wd.notSet}\n${wd.selectionOnlyAtNewChat}`)}
        </div>
      );
    }
    return (
      <div className="inline-flex items-center">
        {copyPathChip(`${fullPath}\n${wd.clickToCopyFullPath}`)}
      </div>
    );
  }

  const titleSelectable = hasPath ? `${fullPath}\n${wd.chooseFolder}` : wd.selectWorkingDirectory;

  return (
    <>
      <div className="inline-flex items-center">
        <button
          type="button"
          disabled={disabled || loading}
          className={cn(
            chipClass,
            'cursor-pointer hover:bg-surface-hover/70 dark:hover:bg-surface-hover/50',
            (disabled || loading) && 'cursor-not-allowed opacity-60',
          )}
          title={titleSelectable}
          aria-label={titleSelectable}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled && !loading) onSelectWorkingDirectoryClick();
          }}
        >
          <FolderInput className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
          <span className="min-w-0 truncate text-left font-medium text-fg">{label}</span>
        </button>
      </div>

      {!hasElectronFolderPicker ? (
        <WorkingDirectoryPickerModal
          open={pathModalOpen}
          onOpenChange={setPathModalOpen}
          initialAbsolutePath={fullPath || undefined}
          onConfirm={applyPath}
          wd={wd}
        />
      ) : null}
    </>
  );
});
