import { MessageSquarePlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import type { GatewayAgentRow } from '@/features/settings/types/agent-gateway';
import { cn } from '@/lib/cn';

function capabilitySummary(agent: GatewayAgentRow, zh: boolean): string[] {
  const deniedTools = Object.values(agent.effective.tools).filter((policy) => policy.mode === 'deny').length;
  const skills = agent.effective.skills;
  const skillText = skills.mode === 'selected'
    ? (zh ? `${skills.include.length} 个技能` : `${skills.include.length} skills`)
    : skills.exclude.length > 0
      ? (zh ? `全部技能，排除 ${skills.exclude.length}` : `All skills, ${skills.exclude.length} excluded`)
      : (zh ? '全部技能' : 'All skills');
  const toolText = deniedTools > 0
    ? (zh ? `${deniedTools} 个工具禁用` : `${deniedTools} tools denied`)
    : (zh ? '工具全部可用' : 'All tools available');
  return [skillText, toolText];
}

export function AgentsListGrid({
  agents,
  busy,
  zh,
  onOpen,
  onChat,
}: {
  agents: GatewayAgentRow[];
  busy: boolean;
  zh: boolean;
  onOpen: (agentId: string) => void;
  onChat: (agentId: string) => void;
}) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {agents.map((agent) => {
        const capabilities = capabilitySummary(agent, zh);
        return (
          <li key={agent.id} className="min-h-0">
            <article
              className={cn(
                'group relative flex min-h-64 flex-col rounded-2xl border border-edge bg-surface-panel p-4 shadow-surface',
                'transition duration-150 hover:-translate-y-0.5 hover:border-accent/30 hover:bg-surface-hover/35',
              )}
            >
              <button
                type="button"
                disabled={busy}
                aria-label={zh ? `配置 ${agent.name}` : `Configure ${agent.name}`}
                onClick={() => onOpen(agent.id)}
                className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <AgentAvatarDisplay agentId={agent.id} avatar={agent.avatar} size={48} className="size-12 shrink-0" />
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-fg">{agent.name}</h2>
                    <p className="mt-0.5 truncate font-mono text-xs text-fg-muted">{agent.id}</p>
                  </div>
                </div>
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  agent.isDefault ? 'bg-accent-soft text-accent' : 'bg-surface-hover text-fg-muted',
                )}>
                  {agent.isDefault ? 'DEFAULT' : (zh ? '自定义' : 'CUSTOM')}
                </span>
              </div>

              <p className="pointer-events-none relative z-10 mt-5 line-clamp-2 min-h-10 text-sm leading-5 text-fg-muted">
                {agent.description || agent.override.profile?.instructions || (zh ? '继承全局能力，仅保存这个 Agent 的差异。' : 'Inherits global capabilities and stores only this agent’s differences.')}
              </p>

              <div className="pointer-events-none relative z-10 mt-4 rounded-xl bg-surface-base px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{zh ? '当前模型' : 'Current model'}</p>
                <p className="mt-1 truncate font-mono text-xs text-fg">{agent.effective.models.chat.primary}</p>
              </div>

              <div className="pointer-events-none relative z-10 mt-3 flex flex-wrap gap-1.5">
                {capabilities.map((label) => <span key={label} className="rounded-full bg-surface-hover px-2 py-1 text-[11px] text-fg-muted">{label}</span>)}
              </div>

              <div className="relative z-10 mt-auto pt-4">
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    onChat(agent.id);
                  }}
                >
                  <MessageSquarePlus className="size-4" />
                  {zh ? '与这个 Agent 对话' : 'Chat with this agent'}
                </Button>
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
