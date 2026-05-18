import * as Dialog from '@radix-ui/react-dialog';
import { Info, X } from 'lucide-react';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import { SkillCardIcon } from '@/features/skills/skill-card-icon';
import { SkillCatalogStructuredPreview } from '@/features/skills/skill-catalog-structured-preview';
import type { SkillsPageVm } from '@/features/skills/use-skills-page';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

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
  | 'usingSkillInChatName'
  | 'installingMarketName'
  | 'togglingSkillName'
  | 'isSkillInstalledByName'
  | 'onUseSkillInChat'
  | 'onMarketInstall'
  | 'onSkillToggle'
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
    usingSkillInChatName,
    installingMarketName,
    togglingSkillName,
    isSkillInstalledByName,
    onUseSkillInChat,
    onMarketInstall,
    onSkillToggle,
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
                {Array.from({ length: 10 }, (_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'h-4 animate-pulse rounded-md bg-surface-hover dark:bg-surface-active/50',
                      i % 3 === 0 ? 'w-[92%]' : i % 3 === 1 ? 'w-full' : 'w-4/5',
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
          <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-4 py-3">
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
                <Button
                  type="button"
                  variant="secondary"
                  disabled={
                    !detailTitle ||
                    detailLoading ||
                    usingSkillInChatName === detailTitle ||
                    togglingSkillName === detailTitle
                  }
                  onClick={() => void onUseSkillInChat()}
                >
                  {usingSkillInChatName === detailTitle ? sk.previewUseInChatBusy : sk.previewUseInChat}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={!detailTitle || togglingSkillName === detailTitle}
                  onClick={async () => {
                    if (!detailTitle) return;
                    const ok = await onSkillToggle(detailTitle, !detailEnabled);
                    if (ok) setDetailOpen(false);
                  }}
                >
                  {detailEnabled ? sk.detailModalDisable : sk.detailModalEnable}
                </Button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
