import type {
  ProductDeliveryEnvelope,
  ProductReference,
  ProductReferenceKind,
} from '@xopcai/gateway-contract';
import { productReferenceOpenRoute } from '@xopcai/gateway-contract';
import {
  AppWindow,
  Bot,
  ChevronRight,
  FileText,
  FolderKanban,
  MessageSquareText,
  NotebookPen,
  Play,
  Settings,
  Target,
  Workflow,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { dispatchFillChatComposer } from '@/features/chat/composer/fill-composer-dispatch';
import { cn } from '@/lib/cn';
import { withDetailReturnTo } from '@/lib/navigation-return';
import { useLocaleStore } from '@/stores/locale-store';

const KIND_ICON = {
  task: Target,
  project: FolderKanban,
  note: NotebookPen,
  workflow_definition: Workflow,
  workflow_run: Play,
  automation: Bot,
  local_app: AppWindow,
  file: FileText,
  session: MessageSquareText,
  settings: Settings,
} satisfies Record<ProductReferenceKind, typeof FileText>;

const KIND_LABELS: Record<ProductReferenceKind, { en: string; zh: string }> = {
  task: { en: 'Task', zh: '结果' },
  project: { en: 'Project', zh: '项目' },
  note: { en: 'Note', zh: '笔记' },
  workflow_definition: { en: 'Workflow', zh: '工作流' },
  workflow_run: { en: 'Workflow run', zh: '工作流运行' },
  automation: { en: 'Automation', zh: '自动化' },
  local_app: { en: 'Local app', zh: '本地应用' },
  file: { en: 'File', zh: '文件' },
  session: { en: 'Conversation', zh: '对话' },
  settings: { en: 'Settings', zh: '设置' },
};

const OPERATION_LABELS = {
  created: { en: 'Created', zh: '已创建' },
  updated: { en: 'Updated', zh: '已更新' },
  opened: { en: 'Ready', zh: '已就绪' },
  started: { en: 'Started', zh: '已启动' },
  completed: { en: 'Completed', zh: '已完成' },
  failed: { en: 'Failed', zh: '失败' },
} satisfies Record<ProductDeliveryEnvelope['operation'], { en: string; zh: string }>;

function continuePrompt(reference: ProductReference, language: 'en' | 'zh'): string {
  return language === 'zh'
    ? `继续处理${KIND_LABELS[reference.kind].zh}「${reference.title}」（ID: ${reference.id}）：`
    : `Continue working on ${KIND_LABELS[reference.kind].en.toLowerCase()} "${reference.title}" (ID: ${reference.id}): `;
}

export function ProductDeliveryCard({
  delivery,
  compact = false,
}: {
  delivery: ProductDeliveryEnvelope;
  compact?: boolean;
}) {
  const reference = delivery.primary;
  const navigate = useNavigate();
  const location = useLocation();
  const storedLanguage = useLocaleStore((state) => state.language);
  const language = storedLanguage === 'zh' ? 'zh' : 'en';
  if (!reference) return null;

  const Icon = KIND_ICON[reference.kind];
  const route = productReferenceOpenRoute(reference);
  const canOpen = Boolean(route && reference.capabilities.includes('open'));
  const canContinue = reference.capabilities.includes('continue_in_chat');
  const isNote = reference.kind === 'note';
  const isFailure = delivery.operation === 'failed';

  const open = () => {
    if (route) navigate(withDetailReturnTo(route, `${location.pathname}${location.search}`));
  };

  if (compact) {
    return (
      <section
        className={cn(
          'mt-2 overflow-hidden rounded-lg border bg-surface-raised',
          isFailure ? 'border-red-300/70 dark:border-red-500/35' : 'border-edge',
        )}
        aria-label={`${OPERATION_LABELS[delivery.operation][language]} ${KIND_LABELS[reference.kind][language]}`}
      >
        <button
          type="button"
          onClick={canOpen ? open : undefined}
          disabled={!canOpen}
          className={cn(
            'flex min-h-10 w-full items-center gap-2.5 px-3 py-2 text-left',
            canOpen && 'transition-colors hover:bg-surface-hover/60',
            !canOpen && 'cursor-default',
          )}
        >
          <Icon
            className={cn(
              'size-4 shrink-0',
              isFailure ? 'text-red-600 dark:text-red-300' : 'text-accent-fg',
            )}
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
            <span className="font-medium text-fg">
              {OPERATION_LABELS[delivery.operation][language]}
            </span>
            <span aria-hidden> · </span>
            <span>{reference.title}</span>
          </span>
          {canOpen ? (
            <span className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-accent">
              {language === 'zh'
                ? `打开${KIND_LABELS[reference.kind].zh}`
                : `Open ${KIND_LABELS[reference.kind].en}`}
              <ChevronRight className="size-3.5" aria-hidden />
            </span>
          ) : null}
        </button>
      </section>
    );
  }

  return (
    <section
      className={cn(
        'mt-2 overflow-hidden rounded-xl border bg-surface-raised',
        isFailure ? 'border-red-300/70 dark:border-red-500/35' : 'border-edge',
      )}
      aria-label={`${OPERATION_LABELS[delivery.operation][language]} ${KIND_LABELS[reference.kind][language]}`}
    >
      <button
        type="button"
        onClick={canOpen ? open : undefined}
        disabled={!canOpen}
        className={cn(
          'flex w-full items-start gap-3 p-3 text-left',
          canOpen && 'transition-colors hover:bg-surface-hover/60',
          !canOpen && 'cursor-default',
        )}
      >
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            isFailure
              ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
              : 'bg-accent-soft text-accent-fg',
          )}
          aria-hidden
        >
          <Icon className="size-4.5" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-fg">{reference.title}</span>
            <span className="rounded-full border border-edge px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
              {KIND_LABELS[reference.kind][language]}
            </span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
            <span>{OPERATION_LABELS[delivery.operation][language]}</span>
            {reference.status ? <span>· {reference.status}</span> : null}
          </span>
          {reference.summary ? (
            <span className="mt-1.5 line-clamp-2 block text-xs leading-relaxed text-fg-subtle">
              {reference.summary}
            </span>
          ) : null}
        </span>
        {canOpen ? (
          isNote ? (
            <span className="mt-1.5 flex shrink-0 items-center gap-0.5 text-xs font-medium text-accent">
              {language === 'zh' ? '打开笔记' : 'Open Note'}
              <ChevronRight className="size-3.5" aria-hidden />
            </span>
          ) : (
            <ChevronRight className="mt-2 size-4 shrink-0 text-fg-disabled" aria-hidden />
          )
        ) : null}
      </button>
      {!isNote && (canOpen || canContinue) ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-edge px-3 py-2">
          {canContinue ? (
            <Button
              type="button"
              variant="ghost"
              className="h-8 px-3 py-1.5 text-xs"
              onClick={() => dispatchFillChatComposer(continuePrompt(reference, language))}
            >
              {language === 'zh' ? '在对话中继续' : 'Continue in chat'}
            </Button>
          ) : null}
          {canOpen ? (
            <Button
              type="button"
              variant="primary"
              className="h-8 px-3 py-1.5 text-xs"
              onClick={open}
            >
              {language === 'zh' ? '打开' : 'Open'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
