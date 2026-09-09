import { MessageSquarePlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import type { GatewayAgentRow } from '@/features/settings/types/agent-gateway';
import { cn } from '@/lib/cn';

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
        return (
          <li key={agent.id} className="min-h-0">
            <article
              className={cn(
                'group relative flex min-h-52 flex-col rounded-2xl border border-edge bg-surface-panel p-4 shadow-surface',
                'transition-[transform,background-color,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-accent/30 hover:bg-surface-hover/35 active:scale-[0.99] motion-reduce:transform-none',
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
                  </div>
                </div>
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  agent.isDefault ? 'bg-accent-soft text-accent' : 'bg-surface-hover text-fg-muted',
                )}>
                  {agent.isDefault ? (zh ? '默认' : 'Default') : (zh ? '自定义' : 'Custom')}
                </span>
              </div>

              <p className="pointer-events-none relative z-10 mt-5 line-clamp-2 min-h-10 text-sm leading-5 text-fg-muted">
                {agent.description || agent.override.profile?.instructions || (zh ? '使用全局配置' : 'Uses global settings')}
              </p>

              <div className="pointer-events-none relative z-10 mt-4 rounded-xl bg-surface-base px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{zh ? '当前模型' : 'Current model'}</p>
                <p className="mt-1 truncate font-mono text-xs text-fg">{agent.effective.models.chat.primary}</p>
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
                  {zh ? '与这个智能体对话' : 'Chat with this agent'}
                </Button>
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
