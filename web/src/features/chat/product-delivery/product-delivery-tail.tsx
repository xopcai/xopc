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
  CircleDotDashed,
  FileText,
  Files,
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
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { withDetailReturnTo } from '@/lib/navigation-return';
import {
  productDeliveryReferences,
  type ProductDeliveryEntry,
} from './product-delivery-model';

const KIND_ICON = {
  task: Target,
  project: FolderKanban,
  note: NotebookPen,
  workflow_definition: Workflow,
  workflow_run: Play,
  automation: Bot,
  scene: CircleDotDashed,
  local_app: AppWindow,
  file: FileText,
  session: MessageSquareText,
  settings: Settings,
} satisfies Record<ProductReferenceKind, typeof FileText>;

const KIND_LABELS: Record<ProductReferenceKind, { en: string; zh: string }> = {
  task: { en: 'Task', zh: '任务' },
  project: { en: 'Project', zh: '项目' },
  note: { en: 'Note', zh: '笔记' },
  workflow_definition: { en: 'Workflow', zh: '工作流' },
  workflow_run: { en: 'Workflow run', zh: '工作流运行' },
  automation: { en: 'Automation', zh: '自动化' },
  scene: { en: 'Scene', zh: '场景' },
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
  inbox: { en: 'Inbox', zh: '收件箱' },
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
  const kind = KIND_LABELS[reference.kind][language];
  const operation = OPERATION_LABELS[delivery.operation][language];
  const status = localizedStatus(reference.status, language);
  const state = status && delivery.operation === 'opened'
    ? status
    : status && status.toLowerCase() !== operation.toLowerCase()
      ? `${operation} · ${status}`
      : status ?? operation;
  return `${kind} · ${state}`;
}

function continuePrompt(reference: ProductReference, language: 'en' | 'zh'): string {
  return language === 'zh'
    ? `继续处理${KIND_LABELS[reference.kind].zh}「${reference.title}」（ID: ${reference.id}）：`
    : `Continue working on ${KIND_LABELS[reference.kind].en.toLowerCase()} "${reference.title}" (ID: ${reference.id}): `;
}

function DeliveryRow({
  delivery,
  reference,
  language,
}: {
  delivery: ProductDeliveryEnvelope;
  reference: ProductReference;
  language: 'en' | 'zh';
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const Icon = KIND_ICON[reference.kind];
  const route = productReferenceOpenRoute(reference);
  const canOpen = Boolean(route && reference.capabilities.includes('open'));
  const canContinue = reference.kind !== 'note' && reference.capabilities.includes('continue_in_chat');
  const isFailure = delivery.operation === 'failed';
  const description = [
    deliveryMeta(delivery, reference, language),
    reference.summary?.trim(),
  ].filter(Boolean).join(' · ');

  const open = () => {
    if (route) navigate(withDetailReturnTo(route, `${location.pathname}${location.search}`));
  };

  return (
    <li className="flex min-w-0 items-stretch" data-product-delivery={reference.kind}>
      <button
        type="button"
        onClick={canOpen ? open : undefined}
        disabled={!canOpen}
        className={cn(
          'flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left',
          canOpen && 'cursor-pointer hover:bg-surface-hover/65 active:bg-surface-active/70',
          interaction.transition,
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
          !canOpen && 'cursor-default',
        )}
      >
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            isFailure
              ? 'bg-danger-soft text-danger'
              : 'bg-accent-soft/70 text-accent-fg',
          )}
          aria-hidden
        >
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg" title={reference.title}>{reference.title}</span>
          <span
            className="mt-0.5 block truncate text-xs leading-5 text-fg-muted"
            title={description}
          >
            {description}
          </span>
        </span>
        {canOpen ? <ChevronRight className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden /> : null}
      </button>
      {canContinue ? (
        <button
          type="button"
          className={cn(
            'm-2 inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-lg px-2.5 text-xs font-medium text-accent-fg',
            'hover:bg-accent-soft active:bg-accent-soft/70',
            interaction.transition,
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
          )}
          onClick={() => dispatchFillChatComposer(continuePrompt(reference, language))}
        >
          {language === 'zh' ? '继续' : 'Continue'}
        </button>
      ) : null}
    </li>
  );
}

type DeliveryReferenceEntry = ReturnType<typeof productDeliveryReferences>[number];

function FileDeliveryGroup({
  entries,
  language,
}: {
  entries: DeliveryReferenceEntry[];
  language: 'en' | 'zh';
}) {
  const label = messages(language).chat.turnOutcome.fileCount
    .replace('{{count}}', String(entries.length));

  return (
    <li data-product-file-group>
      <details className="group">
        <summary
          className={cn(
            'flex min-h-14 cursor-pointer list-none items-center gap-3 px-3 py-2 text-left',
            'hover:bg-surface-hover/65 active:bg-surface-active/70',
            interaction.transition,
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
          )}
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft/70 text-accent-fg"
            aria-hidden
          >
            <Files className="size-4" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1 text-sm font-medium text-fg">{label}</span>
          <ChevronRight
            className="size-4 shrink-0 text-fg-subtle transition-transform duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
            strokeWidth={1.75}
            aria-hidden
          />
        </summary>
        <ul className="m-0 list-none divide-y divide-edge-subtle border-t border-edge-subtle p-0">
          {entries.map(({ key, delivery, reference }) => (
            <DeliveryRow
              key={key}
              delivery={delivery}
              reference={reference}
              language={language}
            />
          ))}
        </ul>
      </details>
    </li>
  );
}

export function ProductDeliveryRows({
  deliveries,
  language,
}: {
  deliveries: ProductDeliveryEntry[];
  language: 'en' | 'zh';
}) {
  const references = productDeliveryReferences(deliveries);
  const fileReferences = references.filter(({ reference }) => reference.kind === 'file');
  const firstFileIndex = references.findIndex(({ reference }) => reference.kind === 'file');

  if (references.length === 0) return null;

  return (
    <>
      {references.map(({ key, delivery, reference }, index) => {
        if (reference.kind !== 'file' || fileReferences.length === 1) {
          return (
            <DeliveryRow
              key={key}
              delivery={delivery}
              reference={reference}
              language={language}
            />
          );
        }
        if (index !== firstFileIndex) return null;
        return (
          <FileDeliveryGroup
            key="file-delivery-group"
            entries={fileReferences}
            language={language}
          />
        );
      })}
    </>
  );
}
