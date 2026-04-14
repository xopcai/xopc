import * as Dialog from '@radix-ui/react-dialog';
import { memo, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { WorkspaceFilePreviewPanel, getFileName } from '@/features/workspace/workspace-file-preview-dialog';
import { cn } from '@/lib/cn';
import { useSidebarStore } from '@/stores/sidebar-store';
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

const MD_MIN = '(min-width: 768px)';

function usePreviewDialogInset() {
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const workspaceOpen = useWorkspacePanelStore((s) => s.open);
  const [isMd, setIsMd] = useState(() =>
    typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(MD_MIN).matches : true,
  );

  useEffect(() => {
    const mq = globalThis.matchMedia(MD_MIN);
    const onChange = () => setIsMd(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return useMemo(() => {
    if (isMd) {
      const left = sidebarCollapsed ? '4.5rem' : '16rem';
      const right = workspaceOpen ? '20rem' : '0';
      return { top: '0', left, right, bottom: '0' } as const;
    }
    return { top: '0', left: '0', right: '0', bottom: '0' } as const;
  }, [isMd, sidebarCollapsed, workspaceOpen]);
}

/**
 * Full workspace file preview: full viewport height; width excludes left app-sidebar and
 * right project-files panel (md+). Small viewports use full width.
 */
export const WorkspacePreviewDialog = memo(function WorkspacePreviewDialog() {
  const { pathname } = useLocation();
  const path = useWorkspacePreviewStore((s) => s.path);
  const setPath = useWorkspacePreviewStore((s) => s.setPath);
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
          <WorkspaceFilePreviewPanel filePath={path} onClose={() => setPath(null)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
});
