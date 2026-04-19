import * as Dialog from '@radix-ui/react-dialog';
import { memo, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { WorkspaceFilePreviewPanel, getFileName } from '@/features/workspace/workspace-file-preview-dialog';
import { cn } from '@/lib/cn';
import { useSidebarStore } from '@/stores/sidebar-store';
import { useWorkspaceEditorAgentStore } from '@/stores/workspace-editor-agent-store';
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

const MD_MIN = '(min-width: 768px)';
const LG_MIN = '(min-width: 1024px)';

function usePreviewDialogInset() {
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const expandedWidthPx = useSidebarStore((s) => s.expandedWidthPx);
  const workspaceOpen = useWorkspacePanelStore((s) => s.open);
  const [isMd, setIsMd] = useState(() =>
    typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(MD_MIN).matches : true,
  );
  const [isLg, setIsLg] = useState(() =>
    typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(LG_MIN).matches : true,
  );

  useEffect(() => {
    const mqMd = globalThis.matchMedia(MD_MIN);
    const mqLg = globalThis.matchMedia(LG_MIN);
    const onMd = () => setIsMd(mqMd.matches);
    const onLg = () => setIsLg(mqLg.matches);
    onMd();
    onLg();
    mqMd.addEventListener('change', onMd);
    mqLg.addEventListener('change', onLg);
    return () => {
      mqMd.removeEventListener('change', onMd);
      mqLg.removeEventListener('change', onLg);
    };
  }, []);

  return useMemo(() => {
    if (!isMd) {
      return { top: '0', left: '0', right: '0', bottom: '0' } as const;
    }
    const right = workspaceOpen ? '20rem' : '0';
    if (!isLg) {
      // Tablet: viewport minus project-files rail only (matches “whole width − 右侧项目文件”).
      return { top: '0', left: '0', right, bottom: '0' } as const;
    }
    const left = sidebarCollapsed ? '4.5rem' : `${expandedWidthPx}px`;
    return { top: '0', left, right, bottom: '0' } as const;
  }, [isMd, isLg, sidebarCollapsed, expandedWidthPx, workspaceOpen]);
}

/**
 * Full workspace file preview: full viewport height. Below `md`, full bleed. From `md` to
 * below `lg`, inset only the project-files rail. At `lg+`, inset left app-sidebar and the
 * project-files rail.
 */
export const WorkspacePreviewDialog = memo(function WorkspacePreviewDialog() {
  const { pathname } = useLocation();
  const path = useWorkspacePreviewStore((s) => s.path);
  const setPath = useWorkspacePreviewStore((s) => s.setPath);
  const editorAgentId = useWorkspaceEditorAgentStore((s) => s.agentId);
  const inset = usePreviewDialogInset();
  const open = Boolean(path);

  useEffect(() => {
    if (!pathname.startsWith('/chat')) {
      setPath(null);
    }
  }, [pathname, setPath]);

  const insetStyle = { top: inset.top, left: inset.left, right: inset.right, bottom: inset.bottom };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && setPath(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed z-[65] bg-scrim" style={insetStyle} />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content-pane fixed z-[66] flex min-h-0 flex-col overflow-hidden border border-edge bg-surface-panel shadow-popover outline-none',
            'dark:border-edge',
          )}
          style={insetStyle}
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">
            {path ? getFileName(path) : 'Preview'}
          </Dialog.Title>
          <WorkspaceFilePreviewPanel
            filePath={path}
            agentId={editorAgentId.trim() || undefined}
            onClose={() => setPath(null)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
});
