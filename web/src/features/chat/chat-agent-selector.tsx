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

function haystack(a: ChatAgentOption): string {
  return `${a.id} ${a.name ?? ''} ${a.description ?? ''}`.toLowerCase();
}

function agentsMatchingQuery(agents: ChatAgentOption[], query: string): ChatAgentOption[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return agents;
  const tokens = raw.split(/\s+/).filter(Boolean);
  return agents.filter((a) => {
    const h = haystack(a);
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => agentsMatchingQuery(items, query), [items, query]);
  const selected = items.find((a) => a.id === value);
  const label = selected ? selected.name?.trim() || selected.id : value || placeholder;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={selected ? `${selected.name ? `${selected.name} · ` : ''}${selected.id}` : placeholder}
          className={cn(
            comboboxTriggerLayoutClass,
            'items-center gap-2 rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2 text-left text-sm font-normal text-fg',
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
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{a.name?.trim() || a.id}</span>
                        {a.name?.trim() ? (
                          <span className="block truncate font-mono text-xs text-fg-muted">{a.id}</span>
                        ) : null}
                        {a.description?.trim() ? (
                          <span className="mt-0.5 line-clamp-2 text-xs leading-snug text-fg-muted">
                            {a.description.trim()}
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
