import * as Dialog from '@radix-ui/react-dialog';
import { ExternalLink, X } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import { withReturnTo } from '@/lib/navigation-return';
import { useLocaleStore } from '@/stores/locale-store';

import type { ProductPreviewTarget } from './product-preview-route';

const PreviewContent = lazy(() => import('./product-preview-content'));
const LABELS = {
  project: ['项目预览', 'Project preview'],
  workflow_run: ['工作流运行', 'Workflow run'],
  workflow_definition: ['工作流预览', 'Workflow preview'],
  automation: ['自动化详情', 'Automation details'],
  local_app: ['应用预览', 'App preview'],
} as const;

export function ProductPreviewSkeleton() {
  return <div className="space-y-4" aria-busy="true"><Skeleton className="h-7 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-32 w-full" /></div>;
}

export function ProductPreviewModal({ target, backgroundPath, onClose }: { target: ProductPreviewTarget; backgroundPath: string; onClose: () => void }) {
  const language = useLocaleStore((state) => state.language);
  const zh = language === 'zh';
  const title = LABELS[target.kind][zh ? 0 : 1];
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-[1px]" />
      <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[90] flex h-[min(48rem,calc(100dvh-2rem))] w-[min(52rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay focus:outline-none">
        <header className="flex shrink-0 items-center gap-3 border-b border-edge bg-surface-panel px-5 py-3.5">
          <Dialog.Title className="min-w-0 flex-1 truncate font-medium text-fg">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{zh ? '查看关联内容，或打开独立页面。' : 'Preview related content or open its full page.'}</Dialog.Description>
          <Link to={withReturnTo(target.href, backgroundPath)} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-accent hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"><ExternalLink className="size-4" aria-hidden />{zh ? '打开独立页面' : 'Open full page'}</Link>
          <Dialog.Close title={zh ? '关闭预览' : 'Close preview'} aria-label={zh ? '关闭预览' : 'Close preview'} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"><X className="size-4" aria-hidden /></Dialog.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-8">
          <Suspense fallback={<ProductPreviewSkeleton />}><PreviewContent key={target.href} target={target} /></Suspense>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
