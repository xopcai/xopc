import { Hand, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { actionApprovalPreferenceScope, rememberAgentActionApproval } from '@/features/chat/session/new-session-preferences';
import { patchSessionAgentConfigView } from '@/features/chat/session/patch-session-agent-config-view';
import { SessionManager } from '@/features/chat/session/session-manager';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const manager = new SessionManager();

export function ActionApprovalControl({ conversationId, agentId, disabled }: { conversationId: string; agentId?: string; disabled: boolean }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const gatewayScope = useGatewayStore(state => state.conversationId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const mode = useChatSessionStore(state => state.sessions[conversationId]?.actionApprovalMode);
  const { data, mutate, isLoading, error: loadError } = useSWR(['action-approval', gatewayScope, conversationId], async () => {
    const config = await manager.loadSessionAgentConfig(conversationId);
    patchSessionAgentConfigView(conversationId, config);
    return config;
  });
  const selected = mode ?? data?.actionApprovalMode;
  const label = zh ? '行动授权' : 'Action permissions';
  const description = selected === 'ask'
    ? (zh ? '访问工作区外文件、联网或执行敏感操作前询问。' : 'Ask before external file access, network use or sensitive actions.')
    : (zh ? '在已连接能力和系统权限内自主执行；显式确认要求继续生效。' : 'Act within connected capabilities and system permissions; explicit confirmation rules still apply.');

  async function save(value: string) {
    if (saving || disabled || (value !== 'ask' && value !== 'full')) return;
    const preferenceScope = actionApprovalPreferenceScope();
    setSaving(true);
    setError('');
    try {
      const current = await manager.loadSessionAgentConfig(conversationId);
      const config = await manager.patchSessionAgentConfig(conversationId, { actionApprovalMode: value, configVersion: current.configVersion });
      if (actionApprovalPreferenceScope() !== preferenceScope) throw new Error('Active Gateway identity changed');
      if (agentId && config.actionApprovalMode === value) rememberAgentActionApproval(agentId, value);
      patchSessionAgentConfigView(conversationId, config);
      await mutate(config, false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await mutate().catch(() => undefined);
    } finally { setSaving(false); }
  }

  if (isLoading && !selected) return <Skeleton className="h-8 w-24 rounded-lg" />;
  return <div className="min-w-0 max-w-full">
    <PopoverSelect value={selected ?? ''} allowEmpty={false} placeholder={label} ariaLabel={label}
      title={disabled ? (zh ? '停止任务后可更改行动授权' : 'Stop the task before changing permissions') : `${description}${agentId ? (zh ? ' 同一 Agent 的新对话会沿用你保存的选择。' : ' New chats with this agent reuse your saved choice.') : ''}`}
      disabled={disabled || saving || !selected}
      triggerIcon={selected === 'full' ? <ShieldAlert className="size-3.5" /> : <Hand className="size-3.5" />}
      triggerClassName={cn('h-8 w-auto max-w-40 gap-1.5 border-transparent bg-transparent text-xs text-fg-muted hover:border-transparent hover:bg-surface-hover',
        selected === 'full' && 'text-danger hover:bg-danger-soft focus-visible:ring-danger [&>svg:last-child]:text-danger')}
      contentClassName="w-44 min-w-0 max-w-[calc(100vw-1rem)]"
      side="top" options={[
        { value: 'ask', label: zh ? '每次确认' : 'Ask for approval' },
        { value: 'full', label: zh ? '完全访问' : 'Full access', tone: 'danger' },
      ]} onChange={value => void save(value)} />
    {error || loadError ? <p role="alert" className="mt-1 max-w-72 text-xs text-danger-fg">{error || (loadError instanceof Error ? loadError.message : String(loadError))}</p> : null}
  </div>;
}
