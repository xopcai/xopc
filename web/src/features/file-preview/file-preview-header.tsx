import { Check, Copy, Download, ExternalLink, Eye, FolderOpen, Link2, Loader2, Maximize2, MessageSquarePlus, Minimize2, MoreHorizontal, Paperclip, Pencil, RefreshCw, Save, WrapText, X } from 'lucide-react';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { WorkspaceTreeControlContext } from '@/features/right-workspace/workspace-context';
import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { PreviewRuntimeToolbar, type PreviewRuntimeController } from '@/features/preview-runtime/preview-runtime';
import type { PreviewActions } from '@/features/preview-runtime/preview-types';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { isElectron } from '@/lib/electron-env';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';

type HeaderAction = {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export type FilePreviewHeaderProps = {
  referenceActions?: Array<{ label: string; onClick: () => void; disabled?: boolean }>;
  onRefresh?: () => void;
  onRetrySave?: () => void;
  name: string;
  subtitle?: ReactNode;
  controller: PreviewRuntimeController;
  actions: PreviewActions;
  expanded: boolean;
  onToggleExpanded?: () => void;
  hideClose?: boolean;
  onClose: () => void;
  edit?: { active: boolean; onToggle: () => void };
  wordWrap?: { active: boolean; onToggle: () => void };
  editInNewChat?: HeaderAction;
  share?: HeaderAction;
  openWithSystemApp?: HeaderAction;
  chooseApp?: HeaderAction;
  recommendedApps?: { name: string; path: string }[];
  recentApps?: { name: string; path: string }[];
  onOpenWithApp?: (path: string) => void;
  onRevealInFolder?: () => void;
  copyPath?: { copied: boolean; onClick: () => void };
  textView?: { active: boolean; onChange: (active: boolean) => void };
  openInBrowser?: { href: string };
};

function HeaderButton({ label, active, disabled, onClick, children }: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40',
        active && 'bg-surface-active text-fg',
        interaction.focusRingPanel,
      )}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PreviewMenuItem({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role={active === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={active}
      className="flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-fg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-fg-muted" aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active ? <Check className="size-4 shrink-0" aria-hidden /> : null}
    </button>
  );
}

/** Shared file header, using the workspace preview's existing layout and actions. */
export function FilePreviewHeader({
  referenceActions = [], onRefresh, onRetrySave, name, subtitle, controller, actions, expanded, onToggleExpanded, onClose,
  hideClose, edit, wordWrap, editInNewChat, share, openWithSystemApp, chooseApp,
  recommendedApps = [], recentApps = [], onOpenWithApp, onRevealInFolder, copyPath, textView, openInBrowser,
}: FilePreviewHeaderProps) {
  const language = useLocaleStore((s) => s.language);
  const labels = messages(language);
  const m = labels.workspace;
  const previewLabel = controller.plugin.id === 'pdf' ? labels.chat.attachmentPreviewPdf
    : controller.plugin.id === 'docx' ? labels.chat.attachmentPreviewDocument
      : controller.plugin.id === 'spreadsheet' ? labels.chat.attachmentPreviewSpreadsheet
        : m.preview;
  const desktop = isElectron();
  const treeControl = useContext(WorkspaceTreeControlContext);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const hasPreviewControls = controller.plugin.capabilities.some((capability) =>
    ['zoom', 'search', 'rotate', 'pageNavigation'].includes(capability),
  );

  useEffect(() => {
    if (!moreMenuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled), a')?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && menuRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const items = [...menuRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), a')];
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setMoreMenuOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [moreMenuOpen]);

  const runMenuAction = (action: () => void) => {
    setMoreMenuOpen(false);
    triggerRef.current?.focus();
    action();
  };

  return (
    <div data-workspace-toolbar className={cn('shrink-0 bg-surface-hover/20 px-3 py-2 sm:px-4', APP_CHROME_NO_DRAG_CLASS)}>
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1 py-0.5">
          <h2 className="truncate text-base font-semibold leading-tight tracking-tight text-fg" title={name}>{name}</h2>
          {subtitle ? <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs leading-tight text-fg-muted">{subtitle}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="relative shrink-0">
            {moreMenuOpen ? <button type="button" className="fixed inset-0 z-40 cursor-default bg-transparent" aria-hidden tabIndex={-1}
              onPointerDown={(event) => { event.preventDefault(); setMoreMenuOpen(false); }} /> : null}
            <button ref={triggerRef} type="button"
              className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg', interaction.focusRingPanel)}
              title={m.moreActions} aria-label={m.moreActions} aria-haspopup="menu" aria-expanded={moreMenuOpen}
              onClick={() => setMoreMenuOpen((value) => !value)}>
              <MoreHorizontal className="size-4" />
            </button>
            {moreMenuOpen ? (
              <div ref={menuRef} role="menu" aria-label={m.moreActions} data-file-preview-menu className="absolute right-0 top-full z-50 mt-1 max-h-[min(32rem,calc(100dvh-8rem))] w-60 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-lg border border-edge bg-surface-panel p-1 shadow-popover">
                {treeControl ? <PreviewMenuItem icon={<FolderOpen className="size-4" />} label={treeControl.label} onClick={() => runMenuAction(treeControl.onToggle)} /> : null}
                {referenceActions.map((action) => <PreviewMenuItem key={action.label} icon={<Paperclip className="size-4" />} label={action.label} disabled={action.disabled} onClick={() => runMenuAction(action.onClick)} />)}
                {onRetrySave ? <PreviewMenuItem icon={<Save className="size-4" />} label={language === 'zh' ? '重试保存' : 'Retry save'} onClick={() => runMenuAction(onRetrySave)} /> : null}
                {onRefresh ? <PreviewMenuItem icon={<RefreshCw className="size-4" />} label={language === 'zh' ? '刷新文件' : 'Refresh file'} onClick={() => runMenuAction(onRefresh)} /> : null}
                {controller.plugin.capabilities.includes('edit') ? <PreviewMenuItem icon={edit?.active ? <Eye className="size-4" /> : <Pencil className="size-4" />} label={edit?.active ? m.preview : m.edit} disabled={!edit} onClick={() => runMenuAction(() => edit?.onToggle())} /> : null}
                {wordWrap ? <PreviewMenuItem icon={<WrapText className="size-4" />} label={m.wordWrap} active={wordWrap.active} onClick={() => runMenuAction(wordWrap.onToggle)} /> : null}
                <PreviewMenuItem icon={expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />} label={expanded ? m.collapsePreview : m.expandPreview} disabled={!onToggleExpanded} onClick={() => runMenuAction(() => onToggleExpanded?.())} />
                <div className="my-1 border-t border-edge-subtle dark:border-edge" />
                <PreviewMenuItem icon={editInNewChat?.loading ? <Loader2 className="size-4 animate-spin" /> : <MessageSquarePlus className="size-4" />} label={m.editInNewChat} disabled={!editInNewChat || editInNewChat.disabled || editInNewChat.loading} onClick={() => runMenuAction(() => editInNewChat?.onClick())} />
                <PreviewMenuItem icon={share?.loading ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />} label={m.shareLink} disabled={!share || share.disabled || share.loading} onClick={() => runMenuAction(() => share?.onClick())} />
                <div className="my-1 border-t border-edge-subtle dark:border-edge" />
                {openInBrowser ? (
                  <a href={openInBrowser.href} target="_blank" rel="noopener noreferrer" role="menuitem"
                    className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-fg hover:bg-surface-hover"
                    onClick={() => setMoreMenuOpen(false)}>
                    <ExternalLink className="size-4 text-fg-muted" aria-hidden />
                    {m.openInBrowser}
                  </a>
                ) : null}
                {openWithSystemApp ? <PreviewMenuItem icon={<ExternalLink className="size-4" />} label={m.openSystemApp}
                  disabled={openWithSystemApp.disabled || openWithSystemApp.loading} onClick={() => runMenuAction(openWithSystemApp.onClick)} /> : null}
                {chooseApp ? <PreviewMenuItem icon={<MoreHorizontal className="size-4" />} label={m.chooseApp}
                  disabled={chooseApp.disabled} onClick={() => runMenuAction(chooseApp.onClick)} /> : null}
                {onOpenWithApp ? [
                  { label: m.recommendedApps, apps: recommendedApps },
                  { label: m.recentApps, apps: recentApps },
                ].map(({ label, apps }) => apps.length > 0 ? (
                  <div key={label} className="mt-1 border-t border-edge-subtle pt-1 dark:border-edge">
                    <p className="px-3 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-normal text-fg-subtle">{label}</p>
                    {apps.map((app) => <button key={app.path} type="button" role="menuitem"
                      className="flex h-9 w-full min-w-0 items-center rounded-md px-2.5 text-left text-sm text-fg hover:bg-surface-hover"
                      title={app.path} onClick={() => runMenuAction(() => onOpenWithApp(app.path))}>
                      <span className="block truncate">{app.name}</span>
                    </button>)}
                  </div>
                ) : null) : null}
                {onRevealInFolder ? <PreviewMenuItem icon={<FolderOpen className="size-4" />} label={m.revealInFolder} onClick={() => runMenuAction(onRevealInFolder)} /> : null}
                {openWithSystemApp || chooseApp || onRevealInFolder ? <div className="my-1 border-t border-edge-subtle dark:border-edge" /> : null}
                <PreviewMenuItem icon={<Download className="size-4" />} label={desktop ? m.saveCopy : m.download} disabled={!actions.canDownload}
                  onClick={() => runMenuAction(() => void actions.onDownload())} />
                {copyPath ? <PreviewMenuItem icon={copyPath.copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                  label={copyPath.copied ? m.pathCopied : desktop ? m.copyFilePath : m.copyWorkspacePath} onClick={() => runMenuAction(copyPath.onClick)} /> : null}
              </div>
            ) : null}
          </div>
          {!hideClose ? <><div className="mx-0.5 h-5 w-px bg-edge-subtle" aria-hidden /><HeaderButton label={m.close} onClick={onClose}><X className="size-4" strokeWidth={1.75} /></HeaderButton></> : null}
        </div>
      </div>
      {hasPreviewControls || textView ? <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-0.5">
        {textView ? (
          <div className="mr-2 flex shrink-0 rounded-lg bg-surface-hover p-0.5" role="group" aria-label={labels.chat.attachmentPreviewText}>
            {[{ active: false, label: previewLabel }, { active: true, label: labels.chat.attachmentPreviewText }].map((option) => (
              <button key={option.label} type="button" aria-pressed={textView.active === option.active}
                className={cn('rounded-md px-2.5 py-1 text-xs font-medium', textView.active === option.active ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:text-fg')}
                onClick={() => textView.onChange(option.active)}>
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        {hasPreviewControls ? <PreviewRuntimeToolbar controller={controller} /> : null}
      </div> : null}
    </div>
  );
}
