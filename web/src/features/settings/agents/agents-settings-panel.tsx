import { Plus } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { rememberSelectedAgent } from '@/features/chat/session/new-session-preferences';
import { AgentEditor } from '@/features/settings/agents/agent-editor';
import { AgentsEditorModal } from '@/features/settings/agents/agents-editor-modal';
import { AgentsListGrid } from '@/features/settings/agents/agents-list-grid';
import { CreateAgentDialog } from '@/features/settings/agents/create-agent-dialog';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import {
  createGatewayAgent,
  deleteGatewayAgent,
  fetchGatewayAgents,
} from '@/features/settings/agents-admin-api';
import type { GatewayAgentRow } from '@/features/settings/types/agent-gateway';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function AgentsSkeleton() {
  return (
    <SettingsPageFrame gap="gap-5">
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

export function AgentsSettingsPanel() {
  const token = useGatewayStore((state) => state.token);
  const language = useLocaleStore((state) => state.language);
  const zh = language === 'zh';
  const navigate = useNavigate();
  const { agentId } = useParams();
  const { data, error, isLoading, mutate } = useSWR(token ? 'settings-gateway-agents' : null, fetchGatewayAgents);
  const [createDraft, setCreateDraft] = useState({ open: false, name: '', instructions: '' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const editorDirtyRef = useRef(false);

  const selected = data?.agents.find((agent) => agent.id === agentId);

  const createAgent = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const next = await createGatewayAgent({
        profile: {
          name: createDraft.name.trim(),
          ...(createDraft.instructions.trim() ? { instructions: createDraft.instructions.trim() } : {}),
        },
      });
      setCreateDraft({ open: false, name: '', instructions: '' });
      navigate(`/agents/${next.createdAgentId}`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const deleteAgent = async (agent: GatewayAgentRow) => {
    if (!window.confirm(zh ? `删除 ${agent.name}？此操作无法撤销。` : `Delete ${agent.name}? This cannot be undone.`)) return;
    setBusy(true);
    setActionError(null);
    try {
      await deleteGatewayAgent(agent.id);
      navigate('/agents');
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
    window.setTimeout(() => navigate(`/agents/${id}`), 0);
  };

  const closeAgent = () => {
    if (editorDirtyRef.current && !window.confirm(zh ? '放弃未保存的更改？' : 'Discard unsaved changes?')) return;
    editorDirtyRef.current = false;
    navigate('/agents');
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
    return <SettingsPageFrame><p className="text-sm text-fg-muted">Gateway token required.</p></SettingsPageFrame>;
  }
  if (error && !data) {
    return <SettingsPageFrame><p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{String(error)}</p><Button onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</Button></SettingsPageFrame>;
  }
  if (isLoading || !data) return <AgentsSkeleton />;

  return (
    <SettingsPageFrame gap="gap-5">
      <SettingsPageHeader
        title="Agents"
        subtitle={zh ? '所有 Agent 默认继承全局能力；这里只配置身份和必要差异。' : 'Every agent inherits global capabilities; configure only identity and necessary differences here.'}
        actions={(
          <>
            <Button onClick={() => navigate('/settings/agent-defaults')}>{zh ? '全局默认配置' : 'Global defaults'}</Button>
            <Button variant="primary" onClick={() => { setActionError(null); setCreateDraft((current) => ({ ...current, open: true })); }}><Plus className="size-4" />{zh ? '新建 Agent' : 'New agent'}</Button>
          </>
        )}
      />

      {(error || actionError) && !selected ? <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{actionError ?? String(error)}</p> : null}

      <AgentsListGrid
        agents={data.agents}
        busy={busy}
        zh={zh}
        onOpen={openAgent}
        onChat={startChat}
      />

      {selected ? (
        <AgentsEditorModal
          agent={selected}
          open
          onOpenChange={(open) => { if (!open) closeAgent(); }}
        >
          <AgentEditor
            key={selected.id}
            agent={selected}
            toolIds={data.builtinToolIds}
            zh={zh}
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
        open={createDraft.open}
        busy={busy}
        error={actionError}
        name={createDraft.name}
        instructions={createDraft.instructions}
        zh={zh}
        onNameChange={(name) => setCreateDraft((current) => ({ ...current, name }))}
        onInstructionsChange={(instructions) => setCreateDraft((current) => ({ ...current, instructions }))}
        onCreate={() => void createAgent()}
        onOpenChange={(open) => {
          if (busy) return;
          setCreateDraft((current) => ({ ...current, open }));
          if (!open) setActionError(null);
        }}
      />
    </SettingsPageFrame>
  );
}
