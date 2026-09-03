import { Check, Copy, Download, ExternalLink, Eye, FolderOpen, Link2, Loader2, Maximize2, MessageSquarePlus, Minimize2, MoreHorizontal, Pencil, WrapText, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

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
  name: string;
  subtitle?: ReactNode;
  controller: PreviewRuntimeController;
  actions: PreviewActions;
  expanded: boolean;
  onToggleExpanded?: () => void;
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
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-fg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-fg-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

/** Shared file header, using the workspace preview's existing layout and actions. */
export function FilePreviewHeader({
  name, subtitle, controller, actions, expanded, onToggleExpanded, onClose,
  edit, wordWrap, editInNewChat, share, openWithSystemApp, chooseApp,
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
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const hasPreviewControls = controller.plugin.capabilities.some((capability) =>
    ['zoom', 'search', 'rotate', 'pageNavigation'].includes(capability),
  );

  useEffect(() => {
    if (!moreMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setMoreMenuOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [moreMenuOpen]);

  const runMenuAction = (action: () => void) => {
    setMoreMenuOpen(false);
    action();
  };

  return (
    <div className={cn('shrink-0 border-b border-edge px-3 py-2 dark:border-edge sm:px-4', APP_CHROME_NO_DRAG_CLASS)}>
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1 py-0.5">
          <h2 className="truncate text-base font-semibold leading-tight tracking-tight text-fg" title={name}>{name}</h2>
          {subtitle ? <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs leading-tight text-fg-muted">{subtitle}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {controller.plugin.capabilities.includes('edit') ? <HeaderButton label={edit?.active ? m.preview : m.edit} active={edit?.active ?? false} disabled={!edit} onClick={edit?.onToggle}>
            {edit?.active ? <Eye className="size-4" /> : <Pencil className="size-4" />}
          </HeaderButton> : null}
          {wordWrap ? <HeaderButton label={m.wordWrap} active={wordWrap.active} onClick={wordWrap.onToggle}><WrapText className="size-4" /></HeaderButton> : null}
          <HeaderButton label={expanded ? m.collapsePreview : m.expandPreview} active={expanded} disabled={!onToggleExpanded} onClick={onToggleExpanded}>
            {expanded ? <Minimize2 className="size-4" strokeWidth={1.75} /> : <Maximize2 className="size-4" strokeWidth={1.75} />}
          </HeaderButton>
          <HeaderButton label={m.editInNewChat} disabled={!editInNewChat || editInNewChat.disabled || editInNewChat.loading} onClick={editInNewChat?.onClick}>
            {editInNewChat?.loading ? <Loader2 className="size-4 animate-spin" /> : <MessageSquarePlus className="size-4" />}
          </HeaderButton>
          <HeaderButton label={m.shareLink} disabled={!share || share.disabled || share.loading} onClick={share?.onClick}>
            {share?.loading ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
          </HeaderButton>
          <div className="relative shrink-0">
            {moreMenuOpen ? <button type="button" className="fixed inset-0 z-40 cursor-default bg-transparent" aria-hidden tabIndex={-1}
              onPointerDown={(event) => { event.preventDefault(); setMoreMenuOpen(false); }} /> : null}
            <button type="button"
              className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg', interaction.focusRingPanel)}
              title={m.moreActions} aria-label={m.moreActions} aria-haspopup="menu" aria-expanded={moreMenuOpen}
              onClick={() => setMoreMenuOpen((value) => !value)}>
              <MoreHorizontal className="size-4" />
            </button>
            {moreMenuOpen ? (
              <div role="menu" data-file-preview-menu className="absolute right-0 top-full z-50 mt-1 w-60 rounded-lg border border-edge bg-surface-panel p-1 shadow-popover">
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
          <div className="mx-0.5 h-5 w-px bg-edge-subtle" aria-hidden />
          <HeaderButton label={m.close} onClick={onClose}><X className="size-4" strokeWidth={1.75} /></HeaderButton>
        </div>
      </div>
      {hasPreviewControls || textView ? <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-0.5">
        {textView ? (
          <div className="mr-2 flex shrink-0 rounded-lg border border-edge p-0.5" role="group" aria-label={labels.chat.attachmentPreviewText}>
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
