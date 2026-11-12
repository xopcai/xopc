import { AssistantCapsuleContent, assistantCapsuleClassName, assistantCapsuleDetailClassName, assistantCapsuleListClassName } from '@/features/chat/messages/assistant-capsule';
import { AutomationTaskCard } from '@/features/automations/automation-task-card';
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
  Files,
  FolderKanban,
  MessageSquareText,
  LayoutTemplate,
  NotebookPen,
  Settings,
  Target,
  UserRound,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import useSWR from 'swr';

import { dispatchFillChatComposer } from '@/features/chat/composer/fill-composer-dispatch';
import { fetchTask } from '@/features/tasks/home-api';
import { taskDetailHref } from '@/features/tasks/task-detail-route';
import { useGatewayStore } from '@/stores/gateway-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';
import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { navigateToNewChat } from '@/features/chat/session/new-chat-navigation';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
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
import { TaskDeliveryGroup } from './task-delivery-group';

const KIND_ICON = {
  agent: UserRound,
  task: Target,
  project: FolderKanban,
  note: NotebookPen,
  automation: Bot,
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
  const operation = labels.operations[delivery.operation];
  const status = localizedStatus(reference.status, language);
  const state = status && delivery.operation === 'opened'
    ? status
    : status && status.toLowerCase() !== operation.toLowerCase()
      ? `${operation} · ${status}`
      : status ?? operation;
  return state;
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
    allocating: labels.allocating,
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
  return labels.continuePrompt.replace(/\{\{(kind|title|id)\}\}/g, (_match: string, key: 'kind' | 'title' | 'id') => ({
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
  fullTitle = false,
}: {
  delivery: ProductDeliveryEnvelope;
  reference: ProductReference;
  language: 'en' | 'zh';
  conversationId?: string | null;
  projectId?: string | null;
  fullTitle?: boolean;
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
  const agentLabels = reference.kind === 'agent' ? messages(language).agentsSettings : null;
  const { data: agents } = useSWR(agentLabels && token ? ['gateway-chat-agents', token] : null, fetchChatAgents);
  const agent = agents?.items.find((item) => item.id === reference.id);
  const title = agentLabels && agent ? agentListDisplayName(agent, agentLabels) : reference.title;
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
    : deliveryMeta(delivery, reference, language);

  if (reference.kind === 'automation' && delivery.operation !== 'failed') return <li className="min-w-0 max-w-full"><AutomationTaskCard automationId={reference.id} runId={reference.runId} language={language} embedded /></li>;

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
    <li className="flex max-w-full min-w-0 flex-wrap items-center gap-2" data-product-delivery={reference.kind}>
      <button
        type="button"
        onClick={canOpen ? open : undefined}
        disabled={!canOpen}
        title={[title, description, reference.summary?.trim()].filter(Boolean).join(' · ')}
        className={cn(assistantCapsuleClassName, canOpen ? 'cursor-pointer' : 'cursor-default', isFailure && 'text-danger')}
      >
        <AssistantCapsuleContent
          icon={agentLabels ? <AgentAvatarDisplay agentId={reference.id} avatar={agent?.avatar} size={18} />
            : <Icon strokeWidth={1.75} className={isFailure ? 'text-danger' : undefined} />}
          title={title}
          meta={agentLabels ? agentLabels.backToEditor : description}
          fullTitle={fullTitle}
          trailing={canOpen ? <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden /> : null}
        />
      </button>
      {agentLabels && canOpen && !isFailure ? (
        <button
          type="button"
          className={assistantCapsuleClassName}
          onClick={() => navigateToNewChat(navigate, '/chat/new?projectScope=none', {
            state: { agentId: reference.id, forceNewChat: true, fromAgentEditor: true },
          })}
        >
          {agentLabels.listChatWithAgent}
        </button>
      ) : canContinue ? (
        <button
          type="button"
          className={cn(
            'inline-flex min-h-11 max-w-full cursor-pointer items-center rounded-[1.125rem] px-3 text-xs text-accent-fg',
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
    <li className="min-w-0 max-w-full" data-product-file-group>
      <details className="group">
        <summary className={cn(assistantCapsuleClassName, 'cursor-pointer list-none')}>
          <AssistantCapsuleContent icon={<Files strokeWidth={1.75} />} title={label}
            trailing={<ChevronRight className="size-3.5 shrink-0 text-fg-subtle transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" aria-hidden />} />
        </summary>
        <ul className={cn(assistantCapsuleListClassName, assistantCapsuleDetailClassName)}>
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
  const taskReferences = references.filter(({ reference }) => reference.kind === 'task');
  const firstTaskIndex = references.findIndex(({ reference }) => reference.kind === 'task');

  if (references.length === 0) return null;

  return (
    <>
      {references.map(({ key, delivery, reference }, index) => {
        if (reference.kind === 'task' && taskReferences.length > 3) {
          return index === firstTaskIndex ? (
            <TaskDeliveryGroup key="task-delivery-group" entries={taskReferences} language={language}
              renderEntry={(entry, fullTitle) => <DeliveryRow key={entry.key} delivery={entry.delivery}
                reference={entry.reference} language={language} conversationId={conversationId}
                projectId={projectId} fullTitle={fullTitle} />} />
          ) : null;
        }
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
