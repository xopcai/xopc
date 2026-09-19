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

const STATUS_LABELS: Record<string, { en: string; zh: string }> = {
  active: { en: 'Active', zh: '运行中' },
  completed: { en: 'Completed', zh: '已完成' },
  disabled: { en: 'Disabled', zh: '已停用' },
  enabled: { en: 'Enabled', zh: '已启用' },
  failed: { en: 'Failed', zh: '失败' },
  paused: { en: 'Paused', zh: '已暂停' },
  ready: { en: 'Ready', zh: '已就绪' },
  running: { en: 'Running', zh: '运行中' },
};

function localizedStatus(status: string | undefined, language: 'en' | 'zh'): string | null {
  const value = status?.trim();
  if (!value) return null;
  return STATUS_LABELS[value.toLowerCase()]?.[language] ?? value;
}

function deliveryMeta(
  delivery: ProductDeliveryEnvelope,
  reference: ProductReference,
  language: 'en' | 'zh',
): string {
  const operation = OPERATION_LABELS[delivery.operation][language];
  const status = localizedStatus(reference.status, language);
  if (!status) return operation;
  if (delivery.operation === 'opened' || status.toLowerCase() === operation.toLowerCase()) {
    return status;
  }
  return `${operation} · ${status}`;
}

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
  const meta = deliveryMeta(delivery, reference, language);

  const open = () => {
    if (route) navigate(withDetailReturnTo(route, `${location.pathname}${location.search}`));
  };

  if (compact) {
    return (
      <section
        className={cn(
          'mt-2 overflow-hidden rounded-lg border bg-surface-inset',
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
        'mt-2 overflow-hidden rounded-xl',
        isFailure
          ? 'border border-red-300/70 bg-danger-soft/30 dark:border-red-500/35'
          : 'bg-surface-panel/20',
      )}
      aria-label={`${OPERATION_LABELS[delivery.operation][language]} ${KIND_LABELS[reference.kind][language]}`}
    >
      <div className="flex min-h-14 items-start gap-1 rounded-xl p-1.5">
        <button
          type="button"
          onClick={canOpen ? open : undefined}
          disabled={!canOpen}
          className={cn(
            'flex min-w-0 flex-1 items-start gap-3 rounded-xl p-1 text-left',
            canOpen && 'transition-colors hover:bg-surface-hover/50',
            !canOpen && 'cursor-default',
          )}
        >
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-xl',
              isFailure
                ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                : 'bg-accent-soft/70 text-accent-fg',
            )}
            aria-hidden
          >
            <Icon className="size-4" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="truncate text-sm font-medium text-fg">{reference.title}</span>
              <span className="text-[11px] font-medium tracking-[0.08em] text-fg-subtle">
                {language === 'zh' ? '交付物' : 'Deliverable'} · {KIND_LABELS[reference.kind][language]}
              </span>
            </span>
            <span className="mt-0.5 block text-xs text-fg-muted">{meta}</span>
            {reference.summary ? (
              <span className="mt-1 line-clamp-1 block text-xs leading-relaxed text-fg-subtle">
                {reference.summary}
              </span>
            ) : null}
          </span>
        </button>
        {!isNote && canContinue ? (
          <button
            type="button"
            className="inline-flex min-h-8 shrink-0 items-center self-center rounded-lg px-2 py-1 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => dispatchFillChatComposer(continuePrompt(reference, language))}
          >
            {language === 'zh' ? '继续' : 'Continue'}
          </button>
        ) : null}
      </div>
    </section>
  );
}
