import { ChevronRight, MessageSquarePlus, Search } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { AgentStatusBadges } from '@/features/settings/agents/agent-status-badges';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import {
  agentListDisplayDescription,
  agentListDisplayName,
  isPersonalAgentId,
} from '@/features/settings/agents/agent-display-names';
import type { GatewayAgentRow } from '@/features/settings/types/agent-gateway';
import type { AgentsSettingsMessages } from '@/i18n/messages';

export const agentDirectoryGrid = 'grid grid-cols-1 gap-2.5 @min-[42rem]/agent-directory:grid-cols-2 @min-[68rem]/agent-directory:grid-cols-3';
type DirectoryItem = { agent: GatewayAgentRow; name: string; description: string };

export function AgentsListGrid({
  agents,
  tuiDefaultAgentId,
  busy,
  messages,
  onOpen,
  onChat,
}: {
  agents: GatewayAgentRow[];
  tuiDefaultAgentId?: string;
  busy: boolean;
  messages: AgentsSettingsMessages;
  onOpen: (agentId: string) => void;
  onChat: (agentId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const headingId = useId();
  const query = search.trim().toLowerCase();
  const sections: Record<'assistants' | 'experts' | 'system', DirectoryItem[]> = { assistants: [], experts: [], system: [] };

  for (const agent of agents) {
    const name = agentListDisplayName(agent, messages);
    const description = agentListDisplayDescription(agent, messages) || agent.override.profile?.instructions?.trim() || '';
    if (query && ![name, description, agent.id].some((value) => value.toLowerCase().includes(query))) continue;

    const item = { agent, name, description };
    if (agent.id === 'task-router' || agent.override.purpose === 'task_dispatcher') sections.system.push(item);
    else if (isPersonalAgentId(agent.id)) sections.assistants.unshift(item);
    else if (agent.id === 'main') sections.assistants.push(item);
    else sections.experts.push(item);
  }

  const cards = (items: DirectoryItem[], canChat = true) => (
    <ul className={agentDirectoryGrid}>
      {items.map(({ agent, name, description }) => {
        const settingsLabel = messages.listConfigureAgent.replace('{{name}}', name);
        const chatLabel = messages.listChatWithName.replace('{{name}}', name);
        return (
          <li key={agent.id} className="relative isolate grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_1fr] items-center gap-x-3 rounded-xl bg-surface-panel p-3">
            <button
              type="button"
              className="absolute inset-0 cursor-pointer rounded-[inherit] transition-colors hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:cursor-default disabled:hover:bg-transparent"
              aria-label={settingsLabel}
              title={settingsLabel}
              disabled={busy}
              onClick={() => onOpen(agent.id)}
            />
            <AgentAvatarDisplay agentId={agent.id} avatar={agent.avatar} size={40} className="pointer-events-none relative col-start-1 row-span-2 row-start-1 size-10" />
            <div className="pointer-events-none relative col-span-2 col-start-2 row-start-1 flex min-w-0 items-start justify-between gap-2">
              <h3 className="truncate text-sm font-semibold text-fg" title={name}>{name}</h3>
              <div className="flex max-w-[65%] shrink-0 flex-wrap justify-end gap-1">
                <AgentStatusBadges agent={agent} tuiDefaultAgentId={tuiDefaultAgentId} messages={messages} showCustom={false} className="justify-end" />
                {!agent.override.enabled ? <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">{messages.listDisabledBadge}</span> : null}
              </div>
            </div>
            {description ? <p className="pointer-events-none relative col-start-2 row-start-2 line-clamp-2 min-w-0 break-words text-xs leading-[1.35rem] text-fg-muted">{description}</p> : null}
            {canChat && agent.override.enabled ? (
              <Button variant="ghost" className="relative col-start-3 row-start-2 min-h-11 min-w-11 gap-1.5 rounded-lg px-2" aria-label={chatLabel} title={chatLabel} disabled={busy} onClick={() => onChat(agent.id)}>
                <MessageSquarePlus className="size-4" aria-hidden />
                <span className="hidden @min-[49rem]/agent-directory:inline">{messages.listChatAction}</span>
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  const hasMatches = Object.values(sections).some((items) => items.length > 0);
  const sectionTitleClass = 'mb-2.5 text-sm font-semibold text-fg';

  return (
    <div className="@container/agent-directory flex min-w-0 flex-col gap-5">
      {agents.length ? (
        <label className="relative block w-full max-w-sm">
          <span className="sr-only">{messages.listSearchPlaceholder}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
          <input
            type="search"
            className="min-h-11 w-full rounded-lg border border-edge bg-surface-panel py-2 pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            value={search}
            placeholder={messages.listSearchPlaceholder}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      ) : null}
      {!hasMatches ? <p role="status" className="rounded-xl bg-surface-panel p-4 text-sm text-fg-muted">{agents.length ? messages.listEmpty : messages.listNoAgentsYet}</p> : null}
      {sections.assistants.length ? (
        <section aria-labelledby={`${headingId}-assistants`}>
          <h2 id={`${headingId}-assistants`} className={sectionTitleClass}>{messages.listAssistantsHeading}</h2>
          {cards(sections.assistants)}
        </section>
      ) : null}
      {sections.experts.length ? (
        <section aria-labelledby={`${headingId}-experts`}>
          <h2 id={`${headingId}-experts`} className={sectionTitleClass}>{messages.listExpertsHeading}</h2>
          {cards(sections.experts)}
        </section>
      ) : null}
      {sections.system.length ? (
        <details open={query ? true : undefined} className="group">
          <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-sm font-medium text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
            {messages.listSystemHeading}
          </summary>
          <div className="mt-2">{cards(sections.system, false)}</div>
        </details>
      ) : null}
    </div>
  );
}
