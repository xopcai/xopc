import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, ArrowDownToLine, Check, Copy, ExternalLink, Eye, File, FolderOpen, Loader2, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  fetchWorkspaceFileBlob,
  importFileReferenceToWorkspace,
  resolveFileReferenceAction,
  resolveWorkspaceFileReference,
  type FileReferenceLocationKind,
  type FileReferenceScope,
  type ImportFileReferenceResult,
  type WorkspaceFileReference,
} from '@/features/workspace/workspace-api';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { isElectron } from '@/lib/electron-env';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';
import { useAsyncResource } from '@/lib/use-async-resource';

import type { ExtractedFilePath } from './tool-result-file-paths';
import { isImageMimeType, looksLikeAbsoluteFilePath } from './tool-result-file-paths';

function InlineWorkspaceImageThumb({
  workspaceRel,
  sessionKey,
  onOpen,
  className,
}: {
  workspaceRel: string;
  sessionKey?: string | null;
  onOpen: () => void;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const blob = await fetchWorkspaceFileBlob(workspaceRel, {
          sessionKey: sessionKey?.trim() || undefined,
        });
        if (cancelled) return;
        const u = URL.createObjectURL(blob);
        revoke = u;
        setUrl(u);
      } catch {
        if (!cancelled) setUrl(null);
      }
    })();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [workspaceRel, sessionKey]);

  if (!url) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group relative size-20 overflow-hidden rounded-lg border border-edge-subtle text-left',
        interaction.press,
        interaction.focusRingPanel,
        'hover:border-accent',
        className,
      )}
      title={workspaceRel}
      aria-label={workspaceRel}
    >
      <img src={url} className="size-full object-cover" alt="" />
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
        <Eye className="size-4 text-white opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={1.75} />
      </div>
    </button>
  );
}

function FileReferenceActionButton({
  icon,
  label,
  copiedLabel,
  onClick,
  copied,
}: {
  icon: ReactNode;
  label: string;
  copiedLabel?: string;
  onClick: () => void;
  copied?: boolean;
}) {
  const doneLabel = copiedLabel ?? label;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
        interaction.focusRingPanel,
        interaction.press,
      )}
    >
      {copied ? <Check className="size-3" strokeWidth={1.75} aria-hidden /> : icon}
      <span>{copied ? doneLabel : label}</span>
    </button>
  );
}

function isOffWorkspaceScope(scope: FileReferenceScope): boolean {
  return scope === 'external' || scope === 'agent-profile' || scope === 'session-artifact';
}

function locationKindBadgeLabel(
  kind: FileReferenceLocationKind | undefined,
  m: ReturnType<typeof messages>['chat']['fileReference'],
): string | null {
  if (!kind) {
    return m.externalBadge;
  }
  return m.locationKind[kind] ?? m.externalBadge;
}

function OffWorkspaceFileCard({
  path,
  refInfo,
  sessionKey,
  onImported,
}: {
  path: ExtractedFilePath;
  refInfo: WorkspaceFileReference;
  sessionKey?: string | null;
  onImported: (result: ImportFileReferenceResult) => void;
}) {
  const navigate = useNavigate();
  const language = useLocaleStore((s) => s.language);
  const chat = messages(language).chat;
  const m = chat.fileReference;
  const canUseSystemShell = isElectron() && Boolean(window.electronAPI?.shell);
  const displayPath = refInfo.absolutePath ?? path.absolutePath;
  const [pathCopied, setPathCopied] = useState(false);

  const openViaGatewayRef = useCallback(
    async (action: 'openExternal' | 'revealInFolder') => {
      if (!refInfo.fileRefId || !canUseSystemShell) return;
      const resolved = await resolveFileReferenceAction(refInfo.fileRefId, action, {
        sessionKey: sessionKey?.trim() || undefined,
      });
      if (!resolved) return;
      if (action === 'openExternal') {
        await window.electronAPI?.shell?.openPath(resolved.absolutePath);
      } else {
        await window.electronAPI?.shell?.showItemInFolder(resolved.absolutePath);
      }
    },
    [canUseSystemShell, refInfo.fileRefId, sessionKey],
  );

  const copyPath = useCallback(() => {
    void copyTextToClipboard(displayPath).then((ok) => {
      if (!ok) return;
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 2000);
    });
  }, [displayPath]);

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const canImport = refInfo.capabilities.includes('importToWorkspace') && Boolean(refInfo.fileRefId);
  const defaultDestination = `imports/${path.fileName || refInfo.displayName}`;

  const isMissing = refInfo.scope === 'missing';
  const isInvalid = refInfo.scope === 'invalid';
  const offWorkspace = isOffWorkspaceScope(refInfo.scope) && refInfo.exists;
  const description = isMissing
    ? m.missingDescription
    : isInvalid
      ? m.invalidDescription
      : offWorkspace
        ? canUseSystemShell
          ? m.offWorkspaceBaseDescription
          : m.browserOffWorkspaceDescription
        : canUseSystemShell
          ? m.externalDescription
          : m.browserExternalDescription;

  const badge =
    offWorkspace || refInfo.scope === 'external' || refInfo.scope === 'agent-profile'
      ? locationKindBadgeLabel(refInfo.locationKind, m)
      : null;

  return (
    <div
      className={cn(
        'flex max-w-xl min-w-0 flex-col gap-1 rounded-lg border px-2.5 py-2 text-xs',
        isMissing || isInvalid
          ? 'border-warning/30 bg-warning/5 text-fg-muted'
          : 'border-edge-subtle bg-surface-panel text-fg',
      )}
      title={displayPath}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {isMissing || isInvalid ? (
          <AlertCircle className="size-3.5 shrink-0 text-warning" strokeWidth={1.75} aria-hidden />
        ) : (
          <File className="size-3.5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
        )}
        <span className="min-w-0 truncate font-medium">{path.fileName || refInfo.displayName}</span>
        {badge ? (
          <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] text-fg-muted">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="line-clamp-2 text-[11px] leading-snug text-fg-muted">{description}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-1 pt-0.5">
        {refInfo.manageRoute ? (
          <FileReferenceActionButton
            icon={<Settings2 className="size-3" strokeWidth={1.75} aria-hidden />}
            label={m.openInSettings}
            onClick={() => navigate(refInfo.manageRoute!)}
          />
        ) : null}
        {canUseSystemShell && refInfo.capabilities.includes('openExternal') ? (
          <FileReferenceActionButton
            icon={<ExternalLink className="size-3" strokeWidth={1.75} aria-hidden />}
            label={m.openExternal}
            onClick={() => void openViaGatewayRef('openExternal')}
          />
        ) : null}
        {canUseSystemShell && refInfo.capabilities.includes('revealInFolder') ? (
          <FileReferenceActionButton
            icon={<FolderOpen className="size-3" strokeWidth={1.75} aria-hidden />}
            label={m.revealInFolder}
            onClick={() => void openViaGatewayRef('revealInFolder')}
          />
        ) : null}
        {refInfo.capabilities.includes('copyPath') ? (
          <FileReferenceActionButton
            icon={<Copy className="size-3" strokeWidth={1.75} aria-hidden />}
            label={m.copyPath}
            copiedLabel={chat.messageCopied}
            copied={pathCopied}
            onClick={copyPath}
          />
        ) : null}
        {canImport ? (
          <FileReferenceActionButton
            icon={<ArrowDownToLine className="size-3" strokeWidth={1.75} aria-hidden />}
            label={m.importToWorkspace}
            onClick={() => setImportDialogOpen(true)}
          />
        ) : null}
      </div>
      {canImport && importDialogOpen ? (
        <ImportToWorkspaceDialog
          key={`${refInfo.fileRefId}:${defaultDestination}`}
          open
          onOpenChange={setImportDialogOpen}
          fileRefId={refInfo.fileRefId!}
          sessionKey={sessionKey}
          sourceLabel={displayPath}
          defaultDestination={defaultDestination}
          onImported={(result) => {
            setImportDialogOpen(false);
            onImported(result);
          }}
        />
      ) : null}
    </div>
  );
}

function ImportToWorkspaceDialog({
  open,
  onOpenChange,
  fileRefId,
  sessionKey,
  sourceLabel,
  defaultDestination,
  onImported,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  fileRefId: string;
  sessionKey?: string | null;
  sourceLabel: string;
  defaultDestination: string;
  onImported: (result: ImportFileReferenceResult) => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language).chat.fileReference;
  const errorMessages = m.importErrors;
  const [destination, setDestination] = useState(defaultDestination);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await importFileReferenceToWorkspace(fileRefId, {
      sessionKey: sessionKey?.trim() || undefined,
      destination: destination.trim() || undefined,
      onConflict: 'rename',
    });
    if (result.ok) {
      onImported(result.payload);
      return;
    }
    setBusy(false);
    const codeMap = errorMessages as Record<string, string>;
    setError(codeMap[result.error.code] ?? codeMap.UNKNOWN ?? result.error.message);
  }, [fileRefId, sessionKey, destination, onImported, errorMessages]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'xopc-dialog-overlay fixed inset-0 bg-scrim backdrop-blur-[1px]',
            SETTINGS_SHELL_OVERLAY_Z,
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2',
            SETTINGS_SHELL_CONTENT_Z,
            'rounded-2xl border border-edge bg-surface-panel p-6 shadow-popover outline-none dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="text-base font-semibold text-fg">{m.importDialogTitle}</Dialog.Title>
          <div className="mt-3 space-y-3 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-fg-disabled">
                {m.importDialogSourceLabel}
              </div>
              <div className="mt-0.5 break-all font-mono text-xs text-fg-muted">{sourceLabel}</div>
            </div>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-fg-disabled">
                {m.importDialogDestinationLabel}
              </span>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                disabled={busy}
                aria-label={m.importDialogDestinationLabel}
                className={cn(
                  'mt-1 w-full rounded-md border border-edge bg-surface px-2 py-1.5 font-mono text-xs text-fg outline-none',
                  'focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60',
                )}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </label>
            {error ? (
              <div className="rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5 text-xs text-danger">
                {error}
              </div>
            ) : null}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              {m.importDialogCancel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void submit()}
              disabled={busy || !destination.trim()}
              className="inline-flex items-center gap-1.5"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              {busy ? m.importInProgress : m.importDialogConfirm}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}


/**
 * Resolves file paths in tool text and offers preview links + safe local file actions.
 */
export function ToolResultFileLinks({
  paths,
  sessionKey,
}: {
  paths: ExtractedFilePath[];
  sessionKey?: string | null;
}) {
  const setPreview = useWorkspacePreviewStore((s) => s.setPath);
  const [refOverrides, setRefOverrides] = useState<Record<string, WorkspaceFileReference | null>>({});
  const pathsKey = useMemo(
    () => paths.map((p) => `${p.absolutePath}\0${p.workspaceRelativePath ?? ''}`).join('\n'),
    [paths],
  );
  const trimmedSessionKey = sessionKey?.trim() || undefined;

  const refsResource = useAsyncResource(
    async () => {
      const next: Record<string, WorkspaceFileReference | null> = {};
      await Promise.all(
        paths.map(async (p) => {
          const hasRealAbs = looksLikeAbsoluteFilePath(p.absolutePath);
          // Prefer rel first when available: it stays valid across remote/local host
          // splits (the original justification for `workspaceRelativePath`). Fall back
          // to the absolute path when rel resolves to missing/invalid AND we have a real
          // abs (cross-linked entries — assistant prose `acp-demo/index.html` paired with
          // tool-result `/Users/.../acp-demo/index.html` that lives outside the workspace).
          let ref: WorkspaceFileReference | null = null;
          if (p.workspaceRelativePath) {
            ref = await resolveWorkspaceFileReference(p.workspaceRelativePath, { sessionKey: trimmedSessionKey });
            const exhausted = ref && (ref.scope === 'missing' || ref.scope === 'invalid');
            if (exhausted && hasRealAbs) {
              const absRef = await resolveWorkspaceFileReference(p.absolutePath, { sessionKey: trimmedSessionKey });
              if (absRef && absRef.scope !== 'missing' && absRef.scope !== 'invalid') {
                ref = absRef;
              }
            }
          } else {
            ref = await resolveWorkspaceFileReference(p.absolutePath, { sessionKey: trimmedSessionKey });
          }
          next[p.absolutePath] = ref;
        }),
      );
      return next;
    },
    [pathsKey, trimmedSessionKey],
    {
      enabled: paths.length > 0,
      initial: null,
      errorData: {},
    },
  );

  if (paths.length === 0) {
    return null;
  }
  if (refsResource.data === null) {
    return null;
  }

  const refByAbs = { ...refsResource.data, ...refOverrides };

  const visible = paths.flatMap((p) => {
    const refInfo = refByAbs[p.absolutePath] ?? null;
    if (!refInfo) return [];
    if (p.origin === 'assistant-markdown' && (refInfo.scope === 'missing' || refInfo.scope === 'invalid')) {
      return [];
    }
    return [{ ...p, refInfo }];
  });

  if (visible.length === 0) {
    return null;
  }

  const workspaceFiles = visible.filter(
    (p) => p.refInfo.scope === 'workspace' && Boolean(p.refInfo.workspaceRelativePath),
  );
  const imagePaths = workspaceFiles.filter((p) => isImageMimeType(p.mimeType));
  const otherWorkspacePaths = workspaceFiles.filter((p) => !isImageMimeType(p.mimeType));
  const nonWorkspacePaths = visible.filter((p) => p.refInfo.scope !== 'workspace');

  return (
    <div className="mt-1.5 min-w-0 space-y-1.5">
      {imagePaths.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {imagePaths.map((p) => {
            const rel = p.refInfo.workspaceRelativePath!;
            return (
              <InlineWorkspaceImageThumb
                key={p.absolutePath}
                workspaceRel={rel}
                sessionKey={sessionKey}
                onOpen={() => setPreview(rel)}
              />
            );
          })}
        </div>
      ) : null}
      {otherWorkspacePaths.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {otherWorkspacePaths.map((p) => {
            const rel = p.refInfo.workspaceRelativePath!;
            return (
              <button
                key={p.absolutePath}
                type="button"
                onClick={() => setPreview(rel)}
                className={cn(
                  'inline-flex max-w-full items-center gap-1.5 rounded-md bg-accent-soft/40 px-2 py-1 text-left text-xs text-accent-fg',
                  'max-w-xs transition-colors hover:bg-accent-soft/60',
                  interaction.focusRingPanel,
                  interaction.press,
                )}
                title={p.absolutePath}
              >
                <File className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="min-w-0 truncate">{p.fileName}</span>
                <Eye className="size-3 shrink-0 opacity-60" strokeWidth={1.75} aria-hidden />
              </button>
            );
          })}
        </div>
      ) : null}
      {nonWorkspacePaths.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {nonWorkspacePaths.map((p) => (
            <OffWorkspaceFileCard
              key={p.absolutePath}
              path={p}
              refInfo={p.refInfo}
              sessionKey={sessionKey}
              onImported={(result) => {
                setRefOverrides((prev) => ({
                  ...prev,
                  [p.absolutePath]: {
                    ...refByAbs[p.absolutePath],
                    fileRefId: result.newFileRefId,
                    scope: 'workspace',
                    locationKind: undefined,
                    manageRoute: undefined,
                    exists: true,
                    isDirectory: false,
                    absolutePath: result.absolutePath,
                    workspaceRelativePath: result.workspaceRelativePath,
                    capabilities: ['preview', 'edit', 'openExternal', 'revealInFolder', 'copyPath'],
                    mtimeMs: result.mtimeMs,
                    errorCode: undefined,
                  } as WorkspaceFileReference,
                }));
                setPreview(result.workspaceRelativePath);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
