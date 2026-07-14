import * as Dialog from '@radix-ui/react-dialog';
import { FolderOpen, Loader2, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import {
  FileTree,
} from '@/features/file-tree/file-tree';
import { fetchGatewayAgents } from '@/features/settings/agents-admin-api';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { useWorkspaceTree } from '@/features/workspace/use-workspace-tree';
import { useGatewayStore } from '@/stores/gateway-store';
import { useWorkspaceEditorAgentStore } from '@/stores/workspace-editor-agent-store';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { Select, SelectOption } from '@/components/ui/popover-select';

/**
 * Modal that browses the workspace file tree and returns the picked path.
 *
 * Workspace scoping mirrors the chat sidebar: defaults to the active
 * `useWorkspaceEditorAgentStore` agent (so what you see in chat matches what
 * the picker shows). The user can switch agents via a top-of-modal dropdown,
 * and the resolved `agentId` is returned alongside the picked path so the
 * caller can attach it to subsequent gateway requests.
 */
export function WorkspacePathPickerDialog({
  open,
  onOpenChange,
  onConfirm,
  initialPath,
  /** Filter what kinds of entries the user can confirm on. */
  selectKind = 'any',
  /** Optional workspace scope. Mirrors the gateway's sessionKey→agentId resolution. */
  sessionKey,
  agentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (picked: { path: string; isDirectory: boolean; agentId: string }) => void;
  initialPath?: string;
  selectKind?: 'file' | 'directory' | 'any';
  sessionKey?: string | null;
  agentId?: string | null;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.workspace;
  const sharesT = m.sharesSettings;

  // Active "chat editor" agent — match the chat sidebar by default.
  const chatEditorAgentId = useWorkspaceEditorAgentStore((s) => s.agentId);
  const token = useGatewayStore((s) => s.token);
  const hasToken = Boolean(token);

  const { data: agentsPayload } = useSWR(
    hasToken ? 'picker-agents-list' : null,
    fetchGatewayAgents,
  );

  // Resolve the agent id to use for the tree:
  // 1) explicit prop wins;
  // 2) chat editor store (matches the chat sidebar);
  // 3) gateway-reported defaultId;
  // 4) first agent in the list.
  const resolvedAgentId = useMemo(() => {
    const explicit = agentId?.trim();
    if (explicit) return explicit;
    const editor = chatEditorAgentId.trim();
    if (editor) return editor;
    if (agentsPayload?.defaultId) return agentsPayload.defaultId;
    if (agentsPayload?.agents?.[0]?.id) return agentsPayload.agents[0].id;
    return '';
  }, [agentId, chatEditorAgentId, agentsPayload]);

  // User can override the agent inside the picker — defaults to resolvedAgentId.
  const [pickedAgentId, setPickedAgentId] = useState<string>(resolvedAgentId);
  useEffect(() => {
    setPickedAgentId(resolvedAgentId);
  }, [resolvedAgentId]);

  const { tree, loading, error, loadRoot, loadChildren, reset } = useWorkspaceTree(
    pickedAgentId,
    sessionKey ?? null,
  );

  const [selected, setSelected] = useState<{ path: string; isDirectory: boolean } | null>(
    initialPath ? { path: initialPath, isDirectory: false } : null,
  );

  // Re-load when the dialog opens, or when the user switches agent inside the dialog.
  useEffect(() => {
    if (!open) {
      reset();
      setSelected(initialPath ? { path: initialPath, isDirectory: false } : null);
      return;
    }
    void loadRoot();
  }, [open, pickedAgentId, sessionKey, loadRoot, reset, initialPath]);

  const handleExpand = useCallback(
    (dirPath: string) => {
      void loadChildren(dirPath);
    },
    [loadChildren],
  );

  const canConfirm =
    selected !== null &&
    (selectKind === 'any' ||
      (selectKind === 'file' && !selected.isDirectory) ||
      (selectKind === 'directory' && selected.isDirectory));

  const helperText = (() => {
    if (!selected) return sharesT.pickerHintNone;
    if (selectKind === 'file' && selected.isDirectory) return sharesT.pickerHintNeedsFile;
    if (selectKind === 'directory' && !selected.isDirectory) return sharesT.pickerHintNeedsDirectory;
    return `${selected.isDirectory ? '📁' : '📄'} ${selected.path}`;
  })();

  const agentOptions = agentsPayload?.agents ?? [];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[71] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
            // Fixed dialog height — the content area below grows to fill it and
            // scrolls internally when the tree overflows. Caps at viewport so
            // narrow windows still see a usable footer.
            'flex h-[min(28rem,calc(100vh-3rem))] flex-col overflow-hidden rounded-lg border border-edge bg-surface-panel shadow-popover outline-none',
          )}
        >
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-edge px-4">
            <FolderOpen className="size-4 shrink-0 text-fg-muted" aria-hidden />
            <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
              {sharesT.pickerTitle}
            </Dialog.Title>
            <button
              type="button"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-50"
              title={m.cron.refresh}
              aria-label={m.cron.refresh}
              disabled={loading}
              onClick={() => void loadRoot()}
            >
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden />
            </button>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
                aria-label={t.close}
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          {agentOptions.length > 0 ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-edge px-4 py-2">
              <label className="text-xs text-fg-muted" htmlFor="picker-agent-select">
                {sharesT.pickerAgentLabel}
              </label>
              <Select
                id="picker-agent-select"
                className="min-w-0 flex-1 rounded-md border border-edge bg-surface-panel px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                value={pickedAgentId}
                onChange={(e) => {
                  setPickedAgentId(e.target.value);
                  setSelected(null);
                }}
              >
                {agentOptions.map((a) => (
                  <SelectOption key={a.id} value={a.id}>
                    {agentListDisplayName(a, m.agentsSettings)}
                    {a.id === agentsPayload?.defaultId ? ' ★' : ''}
                  </SelectOption>
                ))}
              </Select>
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {error ? (
              <p className="shrink-0 px-4 py-2 text-xs text-red-600 dark:text-red-400">
                {t.loadError}: {error}
              </p>
            ) : null}

            {loading && tree.length === 0 ? (
              <p className="flex shrink-0 items-center gap-2 px-4 py-3 text-sm text-fg-muted">
                <Loader2 className="size-4 animate-spin" />
                {t.title}…
              </p>
            ) : (
              <FileTree
                tree={tree}
                selectedPath={selected?.path ?? null}
                onSelectFile={(path) => setSelected({ path, isDirectory: false })}
                onSelectEntry={(path, isDirectory) => setSelected({ path, isDirectory })}
                onExpandDir={handleExpand}
                onAction={undefined}
                emptyHint={t.emptyDir}
              />
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-edge px-4 py-3">
            <p className="min-w-0 flex-1 truncate text-xs text-fg-muted">{helperText}</p>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                {sharesT.cancel}
              </Button>
              <Button
                type="button"
                disabled={!canConfirm}
                onClick={() => {
                  if (selected) {
                    onConfirm({ ...selected, agentId: pickedAgentId });
                    onOpenChange(false);
                  }
                }}
              >
                {sharesT.pickerConfirm}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
