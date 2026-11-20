import { modelPreferenceForAgent, resolveNewSessionSpec } from '@xopcai/gateway-contract';
import { TableCellsSplit, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { createComposerAttachmentHandoff } from '@/features/chat/composer/composer-attachment-handoff';
import type { ComposerContextRef } from '@/features/chat/composer/composer.types';
import { readLocalSessionDraft } from '@/features/chat/session/local-session-drafts';
import { readNewSessionPreferences } from '@/features/chat/session/new-session-preferences';
import { SessionManager } from '@/features/chat/session/session-manager';
import { fetchProject } from '@/features/projects/api';
import { getSessionDetail } from '@/features/sessions/session-api';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';

const ChatPage = lazy(() => import('@/features/chat/chat-page').then(module => ({ default: module.ChatPage })));

async function openWorkbookConversation(id: string, originId?: string, projectId?: string) {
  const key = `xopc.workbook-chat:${useGatewayStore.getState().baseUrl}:${id}`;
  let previous: string | null = null;
  try { previous = localStorage.getItem(key) ?? sessionStorage.getItem(key); } catch { /* Storage is optional. */ }
  if (previous) {
    if (await readLocalSessionDraft(previous)) return previous;
    try {
      await getSessionDetail(previous);
      return previous;
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
    }
  }
  if (originId && originId !== previous) return originId;

  const preferences = readNewSessionPreferences();
  const projectRequest = projectId ? fetchProject(projectId).catch(error => {
    if ((error as { status?: number }).status !== 404) throw error;
  }) : undefined;
  const [agents, project] = await Promise.all([fetchChatAgents(), projectRequest]);
  const { agentId, projectId: scope } = resolveNewSessionSpec(
    { origin: 'workbook', project: project ? { kind: 'project', projectId: project.id } : { kind: 'none' } },
    {
      defaultAgentId: agents.defaultId,
      selectedAgentId: agents.items.find(agent => agent.id === preferences.selectedAgentId)?.id,
      projectDefaultAgentId: agents.items.find(agent => agent.id === project?.defaultAgentId)?.id,
    },
  );
  const model = modelPreferenceForAgent(preferences, agentId);
  const session = await new SessionManager().createSession({
    agentId,
    projectId: scope,
    executionMode: project?.workspaceRoot?.trim() ? 'local_checkout' : undefined,
    initialAgentConfig: model ? { model: model.modelRef, thinkingLevel: model.thinkingLevel } : undefined,
  });
  try { localStorage.setItem(key, session.key); } catch { /* Storage is optional. */ }
  return session.key;
}

export function WorkbookChatPanel({ id, open, zh, originId, projectId, onClose, readSelection, prepareSendContext, onRunSettled }: {
  id: string;
  open: boolean;
  zh: boolean;
  originId?: string;
  projectId?: string;
  onClose: () => void;
  readSelection: () => Promise<File | undefined>;
  prepareSendContext: () => Promise<ComposerContextRef | null>;
  onRunSettled: () => void;
}) {
  const [conversationId, setConversationId] = useState<string>();
  const [attachmentHandoffId, setAttachmentHandoffId] = useState<string>();
  const [addingSelection, setAddingSelection] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const request = useRef<Promise<string> | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    request.current ??= openWorkbookConversation(id, originId, projectId);
    void request.current.then(
      value => { if (active) setConversationId(value); },
      () => { if (active) setFailed(true); },
    );
    return () => { active = false; };
  }, [attempt, id, originId, projectId]);

  useEffect(() => {
    if (open) heading.current?.focus({ preventScroll: true });
  }, [open]);

  async function addSelection() {
    setAddingSelection(true);
    try {
      const file = await readSelection();
      if (file) setAttachmentHandoffId(createComposerAttachmentHandoff(file));
    } finally {
      setAddingSelection(false);
    }
  }

  const loading = <div className="space-y-3 p-4"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-16 w-full rounded-xl" /></div>;
  return <aside id="workbook-chat" data-workbook-chat aria-labelledby="workbook-chat-heading"
    className={cn('file-preview-surface absolute inset-y-0 end-0 z-30 min-h-0 w-[min(26rem,calc(100%-1rem))] shrink-0 flex-col overflow-hidden border-s border-edge shadow-popover @min-[48rem]/space:relative @min-[48rem]/space:w-[clamp(22rem,36%,31rem)] @min-[48rem]/space:shadow-none', open ? 'flex' : 'hidden')}
    onKeyDown={event => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return;
      event.preventDefault();
      onClose();
    }}>
    <header className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-edge-subtle px-3 py-2">
      <h2 id="workbook-chat-heading" ref={heading} tabIndex={-1} className="text-sm font-semibold text-fg outline-none">
        {zh ? '工作簿对话' : 'Workbook chat'}
      </h2>
      <div className="flex items-center gap-1">
        <button type="button" disabled={!conversationId || addingSelection} onClick={() => void addSelection()}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
          <TableCellsSplit className="size-4" aria-hidden />{zh ? '添加选区' : 'Add selection'}
        </button>
        <button type="button" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
          onClick={onClose} aria-label={zh ? '收起工作簿对话' : 'Close workbook chat'}><X className="size-4" aria-hidden /></button>
      </div>
    </header>
    <div className="flex min-h-0 flex-1 flex-col">
      {conversationId ? <Suspense fallback={loading}>
        <ChatPage embedded conversationId={conversationId} prepareSendContext={prepareSendContext} onRunSettled={onRunSettled} embeddedAttachmentHandoffId={open ? attachmentHandoffId : undefined}
          composerPlaceholder={zh ? '提问，或说明想怎么改这份工作簿…' : 'Ask a question or describe a change…'} />
      </Suspense> : failed ? <div role="alert" className="p-4 text-sm text-fg-muted">
        <p>{zh ? '暂时无法打开对话。' : 'Could not open the chat.'}</p>
        <button type="button" className="mt-2 rounded-lg px-2 py-1 text-accent-fg hover:bg-accent-soft" onClick={() => {
          request.current = undefined;
          setFailed(false);
          setAttempt(value => value + 1);
        }}>{zh ? '重试' : 'Retry'}</button>
      </div> : loading}
    </div>
  </aside>;
}
