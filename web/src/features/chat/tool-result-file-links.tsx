import { Eye, File } from 'lucide-react';
import { useEffect, useState } from 'react';

import { fetchWorkspaceFileBlob, resolveWorkspaceAbsoluteToRelative } from '@/features/workspace/workspace-api';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
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
        'group relative h-20 w-20 overflow-hidden rounded-lg border border-edge-subtle text-left',
        interaction.press,
        interaction.focusRingPanel,
        'hover:border-accent',
        className,
      )}
      title={workspaceRel}
      aria-label={workspaceRel}
    >
      <img src={url} className="h-full w-full object-cover" alt="" />
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
        <Eye className="h-4 w-4 text-white opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={1.75} />
      </div>
    </button>
  );
}

/**
 * Resolves workspace file paths in tool text and offers preview links + small image thumbs.
 */
export function ToolResultFileLinks({
  paths,
  sessionKey,
}: {
  paths: ExtractedFilePath[];
  sessionKey?: string | null;
}) {
  const setPreview = useWorkspacePreviewStore((s) => s.setPath);
  const [relByAbs, setRelByAbs] = useState<Record<string, string | null> | null>(null);

  useEffect(() => {
    if (paths.length === 0) {
      setRelByAbs({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Record<string, string | null> = {};
      await Promise.all(
        paths.map(async (p) => {
          if (p.workspaceRelativePath) {
            if (!cancelled) {
              next[p.absolutePath] = p.workspaceRelativePath.replace(/\\/g, '/').replace(/^\/+/, '');
            }
            return;
          }
          const rel = await resolveWorkspaceAbsoluteToRelative(p.absolutePath, {
            sessionKey: sessionKey?.trim() || undefined,
          });
          if (!cancelled) {
            next[p.absolutePath] = rel;
          }
        }),
      );
      if (!cancelled) {
        setRelByAbs(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paths, sessionKey]);

  if (paths.length === 0) {
    return null;
  }
  if (relByAbs === null) {
    return null;
  }

  const visible = paths
    .map((p) => ({ ...p, rel: relByAbs[p.absolutePath] ?? null }))
    .filter((p): p is ExtractedFilePath & { rel: string } => Boolean(p.rel));

  if (visible.length === 0) {
    return null;
  }

  const imagePaths = visible.filter((p) => isImageMimeType(p.mimeType));
  const otherPaths = visible.filter((p) => !isImageMimeType(p.mimeType));

  return (
    <div className="mt-1.5 min-w-0">
      {imagePaths.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-2">
          {imagePaths.map((p) => (
            <InlineWorkspaceImageThumb
              key={p.absolutePath}
              workspaceRel={p.rel}
              sessionKey={sessionKey}
              onOpen={() => setPreview(p.rel)}
            />
          ))}
        </div>
      ) : null}
      {otherPaths.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {otherPaths.map((p) => (
            <button
              key={p.absolutePath}
              type="button"
              onClick={() => setPreview(p.rel)}
              className={cn(
                'inline-flex max-w-full items-center gap-1.5 rounded-md bg-accent-soft/40 px-2 py-1 text-left text-xs text-accent-fg',
                'max-w-xs transition-colors hover:bg-accent-soft/60',
                interaction.focusRingPanel,
                interaction.press,
              )}
              title={p.absolutePath}
            >
              <File className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 truncate">{p.fileName}</span>
              <Eye className="h-3 w-3 shrink-0 opacity-60" strokeWidth={1.75} aria-hidden />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
