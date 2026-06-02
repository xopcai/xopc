import * as Dialog from '@radix-ui/react-dialog';
import { ExternalLink, Info, Trash2, X } from 'lucide-react';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import { SkillCardIcon } from '@/features/skills/skill-card-icon';
import { SkillCatalogStructuredPreview } from '@/features/skills/skill-catalog-structured-preview';
import type { SkillsPageVm } from '@/features/skills/use-skills-page';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

const SKELETON_LINE_WIDTHS = [
  { id: 's0', width: 'w-[92%]' },
  { id: 's1', width: 'w-full' },
  { id: 's2', width: 'w-4/5' },
  { id: 's3', width: 'w-[92%]' },
  { id: 's4', width: 'w-full' },
  { id: 's5', width: 'w-4/5' },
  { id: 's6', width: 'w-[92%]' },
  { id: 's7', width: 'w-full' },
  { id: 's8', width: 'w-4/5' },
  { id: 's9', width: 'w-[92%]' },
] as const;

type Props = Pick<
  SkillsPageVm,
  | 'sk'
  | 'detailOpen'
  | 'setDetailOpen'
  | 'detailSource'
  | 'setDetailSource'
  | 'detailTitle'
  | 'setDetailTitle'
  | 'detailMarkdown'
  | 'setDetailMarkdown'
  | 'detailCatalogPreview'
  | 'setDetailCatalogPreview'
  | 'detailMarketplacePreview'
  | 'setDetailMarketplacePreview'
  | 'detailLoading'
  | 'detailError'
  | 'setDetailError'
  | 'detailEnabled'
  | 'detailDirectoryId'
  | 'detailManaged'
  | 'detailExternalUrl'
  | 'usingSkillInChatName'
  | 'installingMarketName'
  | 'togglingSkillName'
  | 'isSkillInstalledByName'
  | 'onUseSkillInChat'
  | 'onMarketInstall'
  | 'onSkillToggle'
  | 'setConfirmId'
  | 'setConfirmOpen'
>;

export function SkillsPageDetailDialog(p: Props) {
  const {
    sk,
    detailOpen,
    setDetailOpen,
    detailSource,
    setDetailSource,
    detailTitle,
    setDetailTitle,
    detailMarkdown,
    setDetailMarkdown,
    detailCatalogPreview,
    setDetailCatalogPreview,
    detailMarketplacePreview,
    setDetailMarketplacePreview,
    detailLoading,
    detailError,
    setDetailError,
    detailEnabled,
    detailDirectoryId,
    detailManaged,
    detailExternalUrl,
    usingSkillInChatName,
    installingMarketName,
    togglingSkillName,
    isSkillInstalledByName,
    onUseSkillInChat,
    onMarketInstall,
    onSkillToggle,
    setConfirmId,
    setConfirmOpen,
  } = p;

  return (
    <Dialog.Root
      open={detailOpen}
      onOpenChange={(open) => {
        setDetailOpen(open);
        if (!open) {
          setDetailSource('catalog');
          setDetailMarkdown('');
          setDetailCatalogPreview(null);
          setDetailMarketplacePreview(null);
          setDetailError(null);
          setDetailTitle('');
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 z-[60] flex h-[min(88vh,44rem)] max-h-[min(92vh,56rem)] w-[min(100%-2rem,min(92vw,56rem))]',
            '-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-float dark:border-edge',
          )}
        >
          <div className="group flex min-h-[3.25rem] shrink-0 items-center gap-3 border-b border-edge px-4 py-3">
            <SkillCardIcon name={detailTitle || '?'} />
            <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
              {detailTitle || '—'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className={cn(
                  'rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg',
                  interaction.focusRingPanel,
                )}
                aria-label={sk.detailCloseAria}
              >
                <X className="size-5" strokeWidth={1.75} aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <div className="flex min-h-[3.25rem] shrink-0 items-start gap-2 border-b border-blue-200/80 bg-blue-50/95 px-4 py-2.5 text-sm text-fg dark:border-blue-900/50 dark:bg-blue-950/45">
            <Info className="mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-400" strokeWidth={1.75} aria-hidden />
            <p className="min-w-0 leading-relaxed">
              {detailSource === 'store' && detailMarketplacePreview
                ? sk.detailModalBanner
                : detailSource === 'store'
                  ? sk.detailModalBannerStore
                  : sk.detailModalBanner}
            </p>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
            {detailLoading ? (
              <div className="flex h-full min-h-[14rem] flex-col gap-2.5 py-1" aria-busy="true" aria-label={sk.loading}>
                {SKELETON_LINE_WIDTHS.map((entry) => (
                  <div
                    key={entry.id}
                    className={cn(
                      'h-4 animate-pulse rounded-md bg-surface-hover dark:bg-surface-active/50',
                      entry.width,
                    )}
                  />
                ))}
              </div>
            ) : detailError ? (
              <p className="text-sm text-red-600 dark:text-red-400">{detailError}</p>
            ) : detailSource === 'catalog' && detailCatalogPreview ? (
              <SkillCatalogStructuredPreview preview={detailCatalogPreview} sk={sk} />
            ) : detailSource === 'store' && detailMarketplacePreview ? (
              <SkillCatalogStructuredPreview preview={detailMarketplacePreview} sk={sk} />
            ) : (
              <div className="markdown-content min-w-0 break-words">
                <MarkdownView content={detailMarkdown} />
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-edge px-4 py-3">
            <div className="flex items-center gap-2">
              {detailSource === 'store' && detailExternalUrl ? (
                <a
                  href={detailExternalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    'inline-flex h-9 items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-3 text-sm font-medium text-fg-muted',
                    'hover:bg-surface-hover hover:text-fg dark:border-edge',
                    interaction.focusRingPanel,
                  )}
                  aria-label={sk.marketplaceOpenExternalAria}
                  title={sk.marketplaceOpenExternal}
                >
                  <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden />
                  <span>{sk.marketplaceOpenExternal}</span>
                </a>
              ) : null}
              {detailSource === 'catalog' && detailManaged && detailDirectoryId ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                  onClick={() => {
                    setConfirmId(detailDirectoryId);
                    setConfirmOpen(true);
                  }}
                >
                  <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                  {sk.delete}
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {detailSource === 'store' ? (
                <>
                  <Button type="button" variant="ghost" onClick={() => setDetailOpen(false)}>
                    {sk.cancel}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={
                      !detailTitle ||
                      detailLoading ||
                      usingSkillInChatName === detailTitle ||
                      installingMarketName === detailTitle
                    }
                    onClick={() => void onUseSkillInChat()}
                  >
                    {usingSkillInChatName === detailTitle ? sk.previewUseInChatBusy : sk.previewUseInChat}
                  </Button>
                  <Button
                    type="button"
                    variant={isSkillInstalledByName(detailTitle) ? 'secondary' : 'primary'}
                    disabled={!detailTitle || installingMarketName === detailTitle}
                    onClick={() => {
                      if (!detailTitle) return;
                      void onMarketInstall(detailTitle, { useDetailProvider: true });
                    }}
                  >
                    {installingMarketName === detailTitle
                      ? sk.uploading
                      : isSkillInstalledByName(detailTitle)
                        ? sk.marketplaceReinstall
                        : sk.marketplaceInstall}
                  </Button>
                </>
              ) : (
                <>
                  {detailEnabled ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!detailTitle || togglingSkillName === detailTitle}
                      onClick={() => {
                        if (!detailTitle) return;
                        void onSkillToggle(detailTitle, false);
                      }}
                    >
                      {togglingSkillName === detailTitle ? sk.uploading : sk.detailModalDisable}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="primary"
                      disabled={!detailTitle || togglingSkillName === detailTitle}
                      onClick={() => {
                        if (!detailTitle) return;
                        void onSkillToggle(detailTitle, true);
                      }}
                    >
                      {togglingSkillName === detailTitle ? sk.uploading : sk.detailModalEnable}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={
                      !detailTitle ||
                      !detailEnabled ||
                      detailLoading ||
                      usingSkillInChatName === detailTitle ||
                      togglingSkillName === detailTitle
                    }
                    title={!detailEnabled ? sk.useRequiresEnabled : undefined}
                    onClick={() => void onUseSkillInChat()}
                  >
                    {usingSkillInChatName === detailTitle ? sk.previewUseInChatBusy : sk.previewUseInChat}
                  </Button>
                </>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
