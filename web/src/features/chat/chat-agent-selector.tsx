import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  comboboxTriggerLayoutClass,
  formControlBorderFocusClass,
  selectComboboxTriggerFocusClass,
} from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

import type { ChatAgentOption } from '@/features/chat/chat-agents-api';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import {
  agentListDisplayDescription,
  agentListDisplayName,
} from '@/features/settings/agents/agent-display-names';
import type { AgentsSettingsMessages } from '@/i18n/messages';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function haystack(a: ChatAgentOption, agentsMessages: AgentsSettingsMessages): string {
  const name = agentListDisplayName(a, agentsMessages);
  const desc = agentListDisplayDescription(a, agentsMessages);
  return `${a.id} ${name} ${desc}`.toLowerCase();
}

function agentsMatchingQuery(
  agents: ChatAgentOption[],
  query: string,
  agentsMessages: AgentsSettingsMessages,
): ChatAgentOption[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return agents;
  const tokens = raw.split(/\s+/).filter(Boolean);
  return agents.filter((a) => {
    const h = haystack(a, agentsMessages);
    return tokens.every((tok) => h.includes(tok));
  });
}

export function ChatAgentSelector({
  items,
  value,
  disabled,
  placeholder,
  searchPlaceholder,
  noMatches,
  compact,
  contentSide = 'bottom',
  contentAlign = 'end',
  className,
  onChange,
}: {
  items: ChatAgentOption[];
  value: string;
  disabled?: boolean;
  placeholder: string;
  searchPlaceholder: string;
  noMatches: string;
  compact?: boolean;
  contentSide?: 'top' | 'bottom';
  contentAlign?: 'start' | 'center' | 'end';
  className?: string;
  onChange: (agentId: string) => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const agentsMessages = messages(language).agentsSettings;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => agentsMatchingQuery(items, query, agentsMessages),
    [items, query, agentsMessages],
  );
  const selected = items.find((a) => a.id === value);
  const label = selected ? agentListDisplayName(selected, agentsMessages) : value || placeholder;
  const selectedTitle = selected
    ? [agentListDisplayName(selected, agentsMessages), agentListDisplayDescription(selected, agentsMessages)]
        .filter(Boolean)
        .join(' — ')
    : undefined;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={selectedTitle ?? placeholder}
          className={cn(
            comboboxTriggerLayoutClass,
            'items-center gap-2 rounded-lg border border-edge-subtle bg-surface-panel px-2.5 py-2 text-left text-sm font-normal text-fg',
            interaction.transition,
            'hover:border-edge hover:bg-surface-hover/45',
            formControlBorderFocusClass,
            selectComboboxTriggerFocusClass,
            'disabled:cursor-not-allowed disabled:opacity-50',
            'dark:border-edge-subtle dark:hover:bg-surface-hover/55',
            // Compact header: shrink-to-fit label, max ~10ch text + chrome; drop combobox min-w-[10rem].
            compact &&
              'min-w-0 max-w-[min(calc(10ch+3rem),calc(100vw-8rem))] py-1.5 text-[13px]',
            className,
          )}
        >
          {value ? (
            <AgentAvatarDisplay agentId={value} avatar={selected?.avatar} size={28} className="shrink-0" />
          ) : null}
          <span
            className={cn(
              'min-w-0 truncate text-left',
              compact ? 'max-w-[10ch] shrink' : 'flex-1',
            )}
          >
            {label}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-fg-subtle opacity-70" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={contentSide}
          align={contentAlign}
          sideOffset={4}
          collisionPadding={8}
          className={cn(
            'z-50 w-[var(--radix-popover-trigger-width)] min-w-[12rem] max-h-[min(20rem,calc(100vh-6rem))] overflow-hidden rounded-lg border border-edge bg-surface-panel shadow-md',
            interaction,
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="border-b border-edge p-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className={cn(
                'w-full rounded-md border border-edge bg-surface-elevated px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-muted',
                formControlBorderFocusClass,
              )}
              aria-label={searchPlaceholder}
            />
          </div>
          <ul className="max-h-[min(16rem,calc(100vh-10rem))] overflow-y-auto p-1" role="listbox">
            {filtered.length === 0 ? (
              <li className="px-2 py-2 text-sm text-fg-muted">{noMatches}</li>
            ) : (
              filtered.map((a) => {
                const isSel = a.id === value;
                const name = agentListDisplayName(a, agentsMessages);
                const desc = agentListDisplayDescription(a, agentsMessages);
                const descTitle = desc.length > 0 ? desc : undefined;
                return (
                  <li key={a.id} role="option" aria-selected={isSel}>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg',
                        isSel ? 'bg-surface-hover' : 'hover:bg-surface-hover',
                      )}
                      onClick={() => {
                        onChange(a.id);
                        setOpen(false);
                        setQuery('');
                      }}
                    >
                      <Check className={cn('size-4 shrink-0', isSel ? 'opacity-100' : 'opacity-0')} aria-hidden />
                      <AgentAvatarDisplay agentId={a.id} avatar={a.avatar} size={32} className="shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium leading-tight" title={name}>
                          {name}
                        </span>
                        {desc ? (
                          <span
                            className="mt-0.5 block truncate text-xs leading-tight text-fg-muted"
                            title={descTitle}
                          >
                            {desc}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
