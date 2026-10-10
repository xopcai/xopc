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
  LayoutTemplate,
  NotebookPen,
  Play,
  Settings,
  Target,
  Workflow,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import useSWR from 'swr';

import { dispatchFillChatComposer } from '@/features/chat/composer/fill-composer-dispatch';
import { fetchTask } from '@/features/tasks/home-api';
import { taskDetailHref } from '@/features/tasks/task-detail-route';
import { useGatewayStore } from '@/stores/gateway-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { noteDetailHref } from '@/features/notes/note-detail-route';
import { chatProductHref } from '@/features/chat/product-preview/product-preview-route';
import { withDetailReturnTo } from '@/lib/navigation-return';
import {
  productDeliveryReferences,
  workspacePathFromFileResourceId,
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
  chat_preview: LayoutTemplate,
  file: FileText,
  session: MessageSquareText,
  settings: Settings,
} satisfies Record<ProductReferenceKind, typeof FileText>;

function localizedStatus(status: string | undefined, language: 'en' | 'zh'): string | null {
  const value = status?.trim();
  if (!value) return null;
  const labels: Record<string, string> = messages(language).chat.productDelivery.statuses;
  return labels[value.toLowerCase()] ?? value;
}

function deliveryMeta(
  delivery: ProductDeliveryEnvelope,
  reference: ProductReference,
  language: 'en' | 'zh',
): string {
  const labels = messages(language).chat.productDelivery;
  const kind = labels.kinds[reference.kind];
  const operation = labels.operations[delivery.operation];
  const status = localizedStatus(reference.status, language);
  const state = status && delivery.operation === 'opened'
    ? status
    : status && status.toLowerCase() !== operation.toLowerCase()
      ? `${operation} · ${status}`
      : status ?? operation;
  return `${kind} · ${state}`;
}

function taskDeliveryMeta(
  delivery: ProductDeliveryEnvelope,
  state: { phase?: string; resolution?: string; operationalState?: string; attention?: readonly unknown[] },
  language: 'en' | 'zh',
): string {
  const labels = messages(language).chat.productDelivery.taskStates;
  if (state.phase === 'closed') {
    return state.resolution === 'done' ? labels.completed : labels.closed;
  }
  if (state.attention?.length) return labels.blocked;
  const states: Record<string, string> = {
    queued: labels.queued,
    running: labels.running,
    verifying: labels.verifying,
    waiting: labels.waiting,
    blocked: labels.blocked,
    completed: labels.completed,
  };
  const knownState = state.operationalState && states[state.operationalState];
  if (knownState) return knownState;
  if (delivery.operation === 'completed') return labels.completed;
  if (delivery.operation === 'failed') return labels.failed;
  return delivery.operation === 'started' ? labels.assigned : labels.ready;
}

function continuePrompt(reference: ProductReference, language: 'en' | 'zh'): string {
  const labels = messages(language).chat.productDelivery;
  return labels.continuePrompt.replace(/\{\{(kind|title|id)\}\}/g, (_match, key: 'kind' | 'title' | 'id') => ({
    kind: language === 'en' ? labels.kinds[reference.kind].toLowerCase() : labels.kinds[reference.kind],
    title: reference.title,
    id: reference.id,
  })[key]);
}

function DeliveryRow({
  delivery,
  reference,
  language,
  conversationId,
  projectId,
}: {
  delivery: ProductDeliveryEnvelope;
  reference: ProductReference;
  language: 'en' | 'zh';
  conversationId?: string | null;
  projectId?: string | null;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const setPreviewPath = useWorkspacePreviewStore((state) => state.setPath);
  const Icon = KIND_ICON[reference.kind];
  const route = productReferenceOpenRoute(reference);
  const filePath = reference.kind === 'file' && reference.capabilities.includes('preview')
    ? workspacePathFromFileResourceId(reference.id) : null;
  const canPreviewFile = Boolean(filePath && (conversationId?.trim() || projectId?.trim()));
  const canOpen = canPreviewFile || Boolean(route && reference.capabilities.includes('open'));
  const canContinue = reference.kind !== 'note' && reference.kind !== 'task'
    && reference.capabilities.includes('continue_in_chat');
  const isFailure = delivery.operation === 'failed';
  const token = useGatewayStore((state) => state.conversationId);
  const taskDetail = useSWR(reference.kind === 'task' ? ['task-delivery', reference.id, token] : null,
    () => fetchTask(reference.id), { revalidateOnFocus: true });
  useEffect(() => {
    if (reference.kind !== 'task') return;
    const refresh = (event: Event) => {
      const taskId = (event as CustomEvent<{ taskId?: string }>).detail?.taskId;
      if (!taskId || taskId === reference.id) void taskDetail.mutate();
    };
    window.addEventListener('task-changed-v2', refresh);
    window.addEventListener('gateway-realtime-connected', refresh);
    return () => {
      window.removeEventListener('task-changed-v2', refresh);
      window.removeEventListener('gateway-realtime-connected', refresh);
    };
  }, [reference.kind, reference.id, taskDetail.mutate]);
  const description = reference.kind === 'task'
    ? taskDeliveryMeta(delivery, {
      phase: taskDetail.data?.task.phase,
      resolution: taskDetail.data?.task.resolution,
      operationalState: taskDetail.data?.operationalState ?? reference.status,
      attention: taskDetail.data?.attention,
    }, language)
    : [deliveryMeta(delivery, reference, language), reference.summary?.trim()].filter(Boolean).join(' · ');

  const open = () => {
    if (filePath && canPreviewFile) {
      setPreviewPath(filePath, null, projectId, conversationId);
      return;
    }
    if (reference.kind === 'task') {
      navigate(taskDetailHref(`${location.pathname}${location.search}`, reference.id));
      return;
    }
    if (reference.kind === 'note') {
      navigate(noteDetailHref(`${location.pathname}${location.search}`, reference.id));
      return;
    }
    if (route) {
      const target = new URL(route, 'https://xopc.local');
      if (reference.projectId) target.searchParams.set('projectId', reference.projectId);
      if (reference.kind === 'local_app' && reference.revision && /^[a-f0-9]{64}$/.test(reference.revision)) target.searchParams.set('sourceHash', reference.revision);
      navigate(withDetailReturnTo(chatProductHref(`${location.pathname}${location.search}`, `${target.pathname}${target.search}`), `${location.pathname}${location.search}`));
    }
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
          {messages(language).chat.productDelivery.continue}
        </button>
      ) : null}
    </li>
  );
}

type DeliveryReferenceEntry = ReturnType<typeof productDeliveryReferences>[number];

function FileDeliveryGroup({
  entries,
  language,
  conversationId,
  projectId,
}: {
  entries: DeliveryReferenceEntry[];
  language: 'en' | 'zh';
  conversationId?: string | null;
  projectId?: string | null;
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
              conversationId={conversationId}
              projectId={projectId}
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
  excludedReferenceKeys,
  conversationId,
  projectId,
}: {
  deliveries: ProductDeliveryEntry[];
  language: 'en' | 'zh';
  excludedReferenceKeys?: ReadonlySet<string>;
  conversationId?: string | null;
  projectId?: string | null;
}) {
  const references = productDeliveryReferences(deliveries, excludedReferenceKeys);
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
              conversationId={conversationId}
              projectId={projectId}
            />
          );
        }
        if (index !== firstFileIndex) return null;
        return (
          <FileDeliveryGroup
            key="file-delivery-group"
            entries={fileReferences}
            language={language}
            conversationId={conversationId}
            projectId={projectId}
          />
        );
      })}
    </>
  );
}
