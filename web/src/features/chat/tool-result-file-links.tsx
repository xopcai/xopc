import { AlertCircle, Copy, ExternalLink, Eye, File, FolderOpen, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  fetchWorkspaceFileBlob,
  resolveFileReferenceAction,
  resolveWorkspaceFileReference,
  type FileReferenceLocationKind,
  type FileReferenceScope,
  type WorkspaceFileReference,
} from '@/features/workspace/workspace-api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { isElectron } from '@/lib/electron-env';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

import type { ExtractedFilePath } from './tool-result-file-paths';
import { isImageMimeType } from './tool-result-file-paths';

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
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
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
      {icon}
      <span>{label}</span>
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
}: {
  path: ExtractedFilePath;
  refInfo: WorkspaceFileReference;
  sessionKey?: string | null;
}) {
  const navigate = useNavigate();
  const language = useLocaleStore((s) => s.language);
  const m = messages(language).chat.fileReference;
  const canUseSystemShell = isElectron() && Boolean(window.electronAPI?.shell);
  const displayPath = refInfo.absolutePath ?? path.absolutePath;

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
    void copyTextToClipboard(displayPath);
  }, [displayPath]);

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
            onClick={copyPath}
          />
        ) : null}
      </div>
    </div>
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
  const [refByAbs, setRefByAbs] = useState<Record<string, WorkspaceFileReference | null> | null>(null);

  useEffect(() => {
    if (paths.length === 0) {
      setRefByAbs({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Record<string, WorkspaceFileReference | null> = {};
      await Promise.all(
        paths.map(async (p) => {
          const ref = await resolveWorkspaceFileReference(p.workspaceRelativePath || p.absolutePath, {
            sessionKey: sessionKey?.trim() || undefined,
          });
          if (!cancelled) {
            next[p.absolutePath] = ref;
          }
        }),
      );
      if (!cancelled) {
        setRefByAbs(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paths, sessionKey]);

  if (paths.length === 0) {
    return null;
  }
  if (refByAbs === null) {
    return null;
  }

  const visible = paths
    .map((p) => ({ ...p, refInfo: refByAbs[p.absolutePath] ?? null }))
    .filter((p): p is ExtractedFilePath & { refInfo: WorkspaceFileReference } => Boolean(p.refInfo));

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
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
