import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal, Plus, Settings, SlidersHorizontal } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import type { CapabilityHeaderActionChange } from '@/features/capabilities/capability-header-actions';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { newAgentSetupHref, newChatHrefForProject } from '@/features/chat/session/composer-handoff-params';
import { navigateToNewChat } from '@/features/chat/session/new-chat-navigation';
import { rememberSelectedAgent } from '@/features/chat/session/new-session-preferences';
import { usePersonalProfile } from '@/features/personal-agent/use-personal-profile';
import { fetchProjects } from '@/features/projects/api';
import { AgentEditor } from '@/features/settings/agents/agent-editor';
import { AGENTS_APP_LIST_PATH, agentsAppDetailPath } from '@/features/settings/agents/agents-app-path';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { AgentsEditorModal } from '@/features/settings/agents/agents-editor-modal';
import { agentDirectoryGrid, AgentsListGrid } from '@/features/settings/agents/agents-list-grid';
import { CreateAgentDialog, type ManualAgentDraft } from '@/features/settings/agents/create-agent-dialog';
import { ExternalRuntimeQuickCards } from '@/features/settings/agents/external-runtime-config';
import { SettingsPageFrame } from '@/features/settings/settings-page-layout';
import {
  createGatewayAgent,
  deleteGatewayAgent,
  fetchExternalAgentRuntimes,
  fetchGatewayAgents,
} from '@/features/settings/agents-admin-api';
import type { ExternalAgentKind, GatewayAgentRow } from '@/features/settings/types/agent-gateway';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const capabilityPagePadding = 'px-4 pb-7 pt-3 sm:px-6 lg:px-8 lg:pb-9 lg:pt-4';
const capabilityPageWidth = 'max-w-7xl';
type PendingConfirmation =
  | { kind: 'discard'; destination: string }
  | { kind: 'delete'; agentId: string; displayName: string };

function AgentsSkeleton() {
  return (
    <SettingsPageFrame gap="gap-5" padding={capabilityPagePadding} className={capabilityPageWidth}>
      <div className="@container/agent-directory flex flex-col gap-5">
        <Skeleton className="h-11 w-full max-w-sm rounded-lg" />
        {[2, 3].map((count) => (
          <div key={count} className="space-y-2.5">
            <Skeleton className="h-5 w-24" />
            <div className={agentDirectoryGrid}>
              {Array.from({ length: count }, (_, index) => <Skeleton key={index} className="h-24 rounded-xl" />)}
            </div>
          </div>
        ))}
      </div>
    </SettingsPageFrame>
  );
}

export function AgentsSettingsPanel({
  agentId,
  onHeaderActionChange,
}: {
  agentId?: string;
  onHeaderActionChange?: CapabilityHeaderActionChange;
}) {
  const token = useGatewayStore((state) => state.conversationId);
  const language = useLocaleStore((state) => state.language);
  const zh = language === 'zh';
  const messageBundle = messages(language);
  const agentsMessages = messageBundle.agentsSettings;
  const navigate = useNavigate();
  const { profile: personalProfile } = usePersonalProfile();
  const { data, error, isLoading, mutate } = useSWR(token ? 'settings-gateway-agents' : null, fetchGatewayAgents);
  const {
    data: externalRuntimes,
    isLoading: externalRuntimesLoading,
    mutate: mutateExternalRuntimes,
  } = useSWR(
    token ? 'settings-external-agent-runtimes' : null,
    fetchExternalAgentRuntimes,
    { revalidateOnFocus: false },
  );
  const [refreshingRuntimes, setRefreshingRuntimes] = useState(false);
  const { data: gatewayConfigData } = useGatewayConfigSwr(Boolean(token));
  const config = gatewayConfigData?.payload?.config as { tui?: { defaultAgent?: string } } | undefined;
  const tuiDefaultAgentId = config?.tui?.defaultAgent?.trim();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [projectChatAgent, setProjectChatAgent] = useState<string | null>(null);
  const { data: chatProjects, error: chatProjectsError, isLoading: chatProjectsLoading, mutate: reloadChatProjects } = useSWR(
    projectChatAgent && token ? ['external-agent-chat-projects', token] : null,
    () => fetchProjects({ status: 'active', sortBy: 'updatedAt', sortOrder: 'desc', limit: 200 }),
    { revalidateOnFocus: false },
  );
  const projectOptions = chatProjects?.items.filter(project => project.workspaceRoot?.trim()) ?? [];
  const [manualDraft, setManualDraft] = useState<ManualAgentDraft>({
    open: false,
    name: '',
    instructions: '',
    workspace: '',
    execution: 'embedded',
    executionConfig: undefined,
  });
  const editorDirtyRef = useRef(false);

  const selected = data?.agents.find((agent) => agent.id === agentId);
  const startAgentCreation = useCallback(() => {
    if (!data) return;
    setActionError(null);
    rememberSelectedAgent(data.defaultId);
    navigate(newAgentSetupHref(), {
      state: { forceNewChat: true, agentId: data.defaultId },
    });
  }, [data, navigate]);

  const createAgentManually = useCallback(async () => {
    if (busy || !manualDraft.name.trim()) return;
    setBusy(true);
    setManualError(null);
    try {
      const next = await createGatewayAgent({
        profile: {
          name: manualDraft.name.trim(),
          ...(manualDraft.instructions.trim() ? { instructions: manualDraft.instructions.trim() } : {}),
        },
        ...(manualDraft.execution !== 'embedded'
          ? { execution: manualDraft.executionConfig?.kind === manualDraft.execution ? manualDraft.executionConfig : { kind: manualDraft.execution } }
          : manualDraft.workspace.trim() ? { workspace: manualDraft.workspace.trim() } : {}),
      });
      const createdExecution = manualDraft.execution;
      setManualDraft({ open: false, name: '', instructions: '', workspace: '', execution: 'embedded', executionConfig: undefined });
      void mutate(next, { revalidate: false });
      if (createdExecution !== 'embedded') {
        navigate(AGENTS_APP_LIST_PATH);
        return;
      }
      rememberSelectedAgent(next.createdAgentId);
      navigate('/chat/new?projectScope=none', {
        state: { forceNewChat: true, agentId: next.createdAgentId, fromAgentEditor: true },
      });
    } catch (cause) {
      setManualError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [busy, manualDraft, mutate, navigate]);

  const headerContribution = useMemo(() => ({
    overflow: (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button variant="secondary" className="size-9 shrink-0 p-0" aria-label={messageBundle.capabilitiesHub.moreActions} title={messageBundle.capabilitiesHub.moreActions}>
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-xl border border-edge bg-surface-overlay p-1 shadow-popover">
            <DropdownMenu.Item
              className={cn('touch-target flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover', interaction.transition)}
              onSelect={() => navigate('/settings/agent-defaults')}
            >
              <Settings className="size-4 text-fg-muted" aria-hidden />
              {messageBundle.nav.settingsAgentDefaults}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={cn('touch-target flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover', interaction.transition)}
              onSelect={() => {
                setManualError(null);
                setManualDraft((current) => ({ ...current, open: true }));
              }}
            >
              <SlidersHorizontal className="size-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
              {agentsMessages.manualCreateMenu}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    ),
    primary: (
      <Button variant="primary" className="shrink-0" aria-label={agentsMessages.listNewAgentCard} onClick={startAgentCreation}>
        <Plus className="size-4" aria-hidden />
        <span className="hidden sm:inline">{agentsMessages.listNewAgentCard}</span>
      </Button>
    ),
  }), [agentsMessages.listNewAgentCard, agentsMessages.manualCreateMenu, messageBundle.capabilitiesHub.moreActions, messageBundle.nav.settingsAgentDefaults, navigate, startAgentCreation]);

  useLayoutEffect(() => {
    onHeaderActionChange?.(headerContribution);
    return () => onHeaderActionChange?.(null);
  }, [headerContribution, onHeaderActionChange]);

  const deleteAgent = async (agent: GatewayAgentRow) => {
    setBusy(true);
    setActionError(null);
    try {
      await deleteGatewayAgent(agent.id);
      navigate(AGENTS_APP_LIST_PATH);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const startChat = (id: string) => {
    if (id === personalProfile?.agentId) {
      navigate('/personal');
      return;
    }
    if (data?.agents.find(agent => agent.id === id)?.override.execution) {
      setProjectChatAgent(id);
      return;
    }
    rememberSelectedAgent(id);
    navigateToNewChat(navigate, '/chat/new', { state: { forceNewChat: true, agentId: id, fromAgentEditor: true } });
  };

  const openAgent = (id: string) => {
    // Mount the Radix dialog after the originating card click has completed so
    // that the same pointer event cannot be interpreted as an outside click.
    editorDirtyRef.current = false;
    window.setTimeout(() => navigate(agentsAppDetailPath(id)), 0);
  };

  const closeAgent = () => {
    if (editorDirtyRef.current) {
      setPendingConfirmation({ kind: 'discard', destination: AGENTS_APP_LIST_PATH });
      return;
    }
    editorDirtyRef.current = false;
    navigate(AGENTS_APP_LIST_PATH);
  };

  const openDefaults = () => {
    if (editorDirtyRef.current) {
      setPendingConfirmation({ kind: 'discard', destination: '/settings/agent-defaults' });
      return;
    }
    editorDirtyRef.current = false;
    navigate('/settings/agent-defaults');
  };

  const confirmPendingAction = () => {
    if (!pendingConfirmation) return;
    setPendingConfirmation(null);
    if (pendingConfirmation.kind === 'discard') {
      editorDirtyRef.current = false;
      navigate(pendingConfirmation.destination);
      return;
    }
    const agent = data?.agents.find((candidate) => candidate.id === pendingConfirmation.agentId);
    if (agent) void deleteAgent(agent);
  };

  const handleEditorDirty = useCallback((dirty: boolean) => {
    editorDirtyRef.current = dirty;
  }, []);

  const refreshExternalRuntimes = useCallback(async () => {
    setRefreshingRuntimes(true);
    try {
      await mutateExternalRuntimes();
    } finally {
      setRefreshingRuntimes(false);
    }
  }, [mutateExternalRuntimes]);

  const openQuickAddRuntime = useCallback((kind: ExternalAgentKind) => {
    setManualError(null);
    setManualDraft({
      open: true,
      name: kind === 'codex' ? 'Codex' : kind === 'claude' ? 'Claude Code' : 'Antigravity',
      instructions: '',
      workspace: '',
      execution: kind,
      executionConfig: { kind },
    });
  }, []);

  if (!token) {
    return <SettingsPageFrame className={capabilityPageWidth} padding={capabilityPagePadding}><p className="text-sm text-fg-muted">{zh ? '需要本机服务令牌。' : 'Local service token required.'}</p></SettingsPageFrame>;
  }
  if (error && !data) {
    return <SettingsPageFrame className={capabilityPageWidth} padding={capabilityPagePadding}><p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{String(error)}</p><Button onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</Button></SettingsPageFrame>;
  }
  if (isLoading || !data) return <AgentsSkeleton />;

  return (
    <SettingsPageFrame
      gap="gap-5"
      className={capabilityPageWidth}
      padding={capabilityPagePadding}
    >
      {(error || actionError) && !selected ? <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{actionError ?? String(error)}</p> : null}

      <ExternalRuntimeQuickCards
        runtimes={externalRuntimes}
        loading={externalRuntimesLoading}
        refreshing={refreshingRuntimes}
        agents={data.agents}
        zh={zh}
        onRefresh={() => void refreshExternalRuntimes()}
        onAddRuntime={openQuickAddRuntime}
        onOpenAgent={openAgent}
      />

      <AgentsListGrid
        agents={data.agents}
        tuiDefaultAgentId={tuiDefaultAgentId}
        busy={busy}
        messages={agentsMessages}
        onOpen={openAgent}
        onChat={startChat}
      />

      {selected ? (
        <AgentsEditorModal
          agent={selected}
          tuiDefaultAgentId={tuiDefaultAgentId}
          messages={agentsMessages}
          open
          onOpenChange={(open) => { if (!open) closeAgent(); }}
        >
          <AgentEditor
            key={selected.id}
            agent={selected}
            toolIds={data.builtinToolIds}
            externalRuntimes={externalRuntimes}
            zh={zh}
            messages={agentsMessages}
            externalError={actionError}
            onDirtyChange={handleEditorDirty}
            onClose={closeAgent}
            onOpenDefaults={openDefaults}
            onChat={() => startChat(selected.id)}
            onDelete={() => setPendingConfirmation({
              kind: 'delete',
              agentId: selected.id,
              displayName: agentListDisplayName(selected, agentsMessages),
            })}
          />
        </AgentsEditorModal>
      ) : null}

      <CreateAgentDialog
        draft={manualDraft}
        busy={busy}
        error={manualError}
        zh={zh}
        externalRuntimes={externalRuntimes}
        messages={agentsMessages}
        workingDirectoryMessages={messageBundle.chat.workingDirectory}
        onChange={(patch) => setManualDraft((current) => ({ ...current, ...patch }))}
        onCreate={() => void createAgentManually()}
        onOpenChange={(open) => {
          if (busy) return;
          setManualDraft((current) => ({ ...current, open }));
          if (!open) setManualError(null);
        }}
      />

      <Dialog.Root open={projectChatAgent !== null} onOpenChange={(open) => { if (!open) setProjectChatAgent(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)} />
          <Dialog.Content className={cn('xopc-dialog-content fixed left-1/2 top-1/2 w-[min(100%-2rem,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-edge bg-surface-overlay p-5 shadow-popover outline-none', SETTINGS_SHELL_CONTENT_Z)}>
            <Dialog.Title className="text-base font-semibold text-fg">{zh ? '开始项目对话' : 'Start Project chat'}</Dialog.Title>
            <Dialog.Description className="mb-4 mt-2 text-sm text-fg-muted">
              {zh ? '请选择已设置工作区的项目。' : 'Choose a Project with a workspace.'}
            </Dialog.Description>
            <PopoverSelect value="" options={projectOptions.map(project => ({ value: project.id, label: project.name }))}
              placeholder={messageBundle.chat.composerContext.chooseProject} loading={chatProjectsLoading}
              searchPlaceholder={messageBundle.chat.composerContext.searchProjects}
              statusMessage={chatProjectsError ? messageBundle.chat.composerContext.projectsFailed : undefined}
              onChange={(projectId) => {
                if (!projectChatAgent || !projectOptions.some(project => project.id === projectId)) return;
                setProjectChatAgent(null);
                navigateToNewChat(navigate, newChatHrefForProject(projectId), {
                  state: { forceNewChat: true, agentId: projectChatAgent, fromAgentEditor: true },
                });
              }} />
            {!chatProjectsLoading && !chatProjectsError && projectOptions.length === 0 ? (
              <p className="mt-3 text-sm text-fg-muted">{zh ? '当前没有已设置工作区的项目。' : 'No active Projects have a workspace.'}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              {chatProjectsError ? <Button variant="secondary" onClick={() => void reloadChatProjects()}>{zh ? '重试' : 'Retry'}</Button> : null}
              <Dialog.Close asChild><Button variant="secondary">{zh ? '取消' : 'Cancel'}</Button></Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={pendingConfirmation !== null}
        title={pendingConfirmation?.kind === 'delete'
          ? (zh ? `删除 ${pendingConfirmation.displayName}？` : `Delete ${pendingConfirmation.displayName}?`)
          : (zh ? '放弃未保存的更改？' : 'Discard unsaved changes?')}
        description={pendingConfirmation?.kind === 'delete'
          ? (zh ? '此操作无法撤销。' : 'This cannot be undone.')
          : (zh ? '当前更改尚未保存，离开后将丢失。' : 'Your changes have not been saved. Leaving will discard them.')}
        confirmLabel={pendingConfirmation?.kind === 'delete'
          ? (zh ? '删除' : 'Delete')
          : (zh ? '放弃并离开' : 'Discard and leave')}
        cancelLabel={zh ? '继续编辑' : 'Keep editing'}
        destructive
        overlayClassName="z-[100]"
        contentClassName="z-[101]"
        onConfirm={confirmPendingAction}
        onCancel={() => setPendingConfirmation(null)}
      />

    </SettingsPageFrame>
  );
}
