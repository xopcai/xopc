import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal, Plus, Settings, SlidersHorizontal } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { CapabilityHeaderActionChange } from '@/features/capabilities/capability-header-actions';
import { rememberSelectedAgent } from '@/features/chat/session/new-session-preferences';
import { AgentEditor } from '@/features/settings/agents/agent-editor';
import { AGENTS_APP_LIST_PATH, agentsAppDetailPath } from '@/features/settings/agents/agents-app-path';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { AgentsEditorModal } from '@/features/settings/agents/agents-editor-modal';
import { AgentsListGrid } from '@/features/settings/agents/agents-list-grid';
import { CreateAgentDialog, type ManualAgentDraft } from '@/features/settings/agents/create-agent-dialog';
import { SettingsPageFrame } from '@/features/settings/settings-page-layout';
import {
  createGatewayAgent,
  deleteGatewayAgent,
  fetchGatewayAgents,
} from '@/features/settings/agents-admin-api';
import type { GatewayAgentRow } from '@/features/settings/types/agent-gateway';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const capabilityPagePadding = 'px-4 pb-7 pt-3 sm:px-6 lg:px-8 lg:pb-9 lg:pt-4';

function AgentsSkeleton() {
  return (
    <SettingsPageFrame gap="gap-5" padding={capabilityPagePadding}>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2"><Skeleton className="h-7 w-28" /><Skeleton className="h-4 w-80 max-w-full" /></div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((item) => <Skeleton key={item} className="h-64 rounded-2xl" />)}
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
  const { data, error, isLoading, mutate } = useSWR(token ? 'settings-gateway-agents' : null, fetchGatewayAgents);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualDraft, setManualDraft] = useState<ManualAgentDraft>({
    open: false,
    name: '',
    instructions: '',
    workspace: '',
  });
  const editorDirtyRef = useRef(false);

  const selected = data?.agents.find((agent) => agent.id === agentId);
  const startAgentCreation = useCallback(() => {
    if (!data) return;
    setActionError(null);
    rememberSelectedAgent(data.defaultId);
    const search = new URLSearchParams({
      agentSetup: '1',
      projectScope: 'none',
      draft: agentsMessages.setupDraftPrefix,
    });
    navigate(`/chat/new?${search.toString()}`, {
      state: { forceNewChat: true, agentId: data.defaultId },
    });
  }, [agentsMessages.setupDraftPrefix, data, navigate]);

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
        ...(manualDraft.workspace.trim() ? { workspace: manualDraft.workspace.trim() } : {}),
      });
      setManualDraft({ open: false, name: '', instructions: '', workspace: '' });
      rememberSelectedAgent(next.createdAgentId);
      navigate('/chat/new?projectScope=none', {
        state: { forceNewChat: true, agentId: next.createdAgentId },
      });
    } catch (cause) {
      setManualError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [busy, manualDraft, navigate]);

  const headerContribution = useMemo(() => ({
    overflow: (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button variant="secondary" className="size-9 shrink-0 p-0" aria-label={messageBundle.capabilitiesHub.moreActions} title={messageBundle.capabilitiesHub.moreActions}>
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-xl border border-edge bg-surface-panel p-1 shadow-popover">
            <DropdownMenu.Item
              className={cn('touch-target flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover', interaction.transition)}
              onSelect={() => navigate('/settings/agent-defaults')}
            >
              <Settings className="size-4 text-fg-muted" aria-hidden />
              {zh ? '全局默认配置' : 'Global defaults'}
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
  }), [agentsMessages.listNewAgentCard, agentsMessages.manualCreateMenu, messageBundle.capabilitiesHub.moreActions, navigate, startAgentCreation, zh]);

  useLayoutEffect(() => {
    onHeaderActionChange?.(headerContribution);
    return () => onHeaderActionChange?.(null);
  }, [headerContribution, onHeaderActionChange]);

  const deleteAgent = async (agent: GatewayAgentRow) => {
    const displayName = agentListDisplayName(agent, agentsMessages);
    if (!window.confirm(zh ? `删除 ${displayName}？此操作无法撤销。` : `Delete ${displayName}? This cannot be undone.`)) return;
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
    rememberSelectedAgent(id);
    navigate('/chat/new');
  };

  const openAgent = (id: string) => {
    // Mount the Radix dialog after the originating card click has completed so
    // that the same pointer event cannot be interpreted as an outside click.
    editorDirtyRef.current = false;
    window.setTimeout(() => navigate(agentsAppDetailPath(id)), 0);
  };

  const closeAgent = () => {
    if (editorDirtyRef.current && !window.confirm(zh ? '放弃未保存的更改？' : 'Discard unsaved changes?')) return;
    editorDirtyRef.current = false;
    navigate(AGENTS_APP_LIST_PATH);
  };

  const openDefaults = () => {
    if (editorDirtyRef.current && !window.confirm(zh ? '放弃未保存的更改？' : 'Discard unsaved changes?')) return;
    editorDirtyRef.current = false;
    navigate('/settings/agent-defaults');
  };

  const handleEditorDirty = useCallback((dirty: boolean) => {
    editorDirtyRef.current = dirty;
  }, []);

  if (!token) {
    return <SettingsPageFrame padding={capabilityPagePadding}><p className="text-sm text-fg-muted">{zh ? '需要本机服务令牌。' : 'Local service token required.'}</p></SettingsPageFrame>;
  }
  if (error && !data) {
    return <SettingsPageFrame padding={capabilityPagePadding}><p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{String(error)}</p><Button onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</Button></SettingsPageFrame>;
  }
  if (isLoading || !data) return <AgentsSkeleton />;

  return (
    <SettingsPageFrame
      gap="gap-5"
      className="max-w-6xl"
      padding={capabilityPagePadding}
    >
      {(error || actionError) && !selected ? <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{actionError ?? String(error)}</p> : null}

      <AgentsListGrid
        agents={data.agents}
        busy={busy}
        messages={agentsMessages}
        onOpen={openAgent}
        onChat={startChat}
      />

      {selected ? (
        <AgentsEditorModal
          agent={selected}
          messages={agentsMessages}
          open
          onOpenChange={(open) => { if (!open) closeAgent(); }}
        >
          <AgentEditor
            key={selected.id}
            agent={selected}
            toolIds={data.builtinToolIds}
            zh={zh}
            messages={agentsMessages}
            externalError={actionError}
            onDirtyChange={handleEditorDirty}
            onClose={closeAgent}
            onOpenDefaults={openDefaults}
            onChat={() => startChat(selected.id)}
            onDelete={() => void deleteAgent(selected)}
          />
        </AgentsEditorModal>
      ) : null}

      <CreateAgentDialog
        draft={manualDraft}
        busy={busy}
        error={manualError}
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

    </SettingsPageFrame>
  );
}
