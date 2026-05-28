import { Search, Wrench, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import type { McpToolInfo } from '@/features/settings/mcp/mcp-config-api';
import { toolMatchesQuery } from '@/features/settings/mcp/mcp-tools-utils';
import { cn } from '@/lib/cn';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: string;
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  searchEmptyLabel: string;
  emptyLabel: string;
  closeLabel: string;
  tools: McpToolInfo[];
  stripPrefix?: string;
};

function displayToolName(fullName: string | undefined, stripPrefix?: string): string {
  if (!fullName) return '';
  if (stripPrefix && fullName.startsWith(stripPrefix)) {
    return fullName.slice(stripPrefix.length);
  }
  return fullName;
}

function McpToolsListSearch({
  tools,
  stripPrefix,
  searchPlaceholder,
  searchEmptyLabel,
}: {
  tools: McpToolInfo[];
  stripPrefix?: string;
  searchPlaceholder: string;
  searchEmptyLabel: string;
}) {
  const [query, setQuery] = useState('');

  const filteredTools = useMemo(
    () => tools.filter((tool) => toolMatchesQuery(tool, query, stripPrefix)),
    [query, stripPrefix, tools],
  );

  const hasQuery = query.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-edge px-5 py-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className={cn(
              'w-full rounded-lg border border-edge bg-surface-panel py-2 pl-9 pr-3 text-sm text-fg',
              'placeholder:text-fg-subtle',
              settingsInputFocusClass,
            )}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {hasQuery ? (
          <p className="mt-2 text-xs text-fg-subtle">
            {filteredTools.length} / {tools.length}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {filteredTools.length === 0 ? (
          <p className="text-sm text-fg-muted">{searchEmptyLabel}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filteredTools.map((tool, index) => {
              const shortName =
                tool.shortName || displayToolName(tool.name, stripPrefix) || tool.name || '?';
              const toolKey = tool.name || `tool-${index}`;
              return (
                <li
                  key={toolKey}
                  className="min-w-0 rounded-lg border border-edge bg-surface-base px-3 py-2.5"
                >
                  <div
                    className="truncate font-mono text-sm font-medium text-fg"
                    title={tool.name !== shortName ? tool.name : shortName}
                  >
                    {shortName}
                  </div>
                  {tool.description ? (
                    <p
                      className="mt-1 truncate text-xs leading-relaxed text-fg-muted"
                      title={tool.description}
                    >
                      {tool.description}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function McpToolsListDialog({
  open,
  onOpenChange,
  serverId,
  title,
  subtitle,
  searchPlaceholder,
  searchEmptyLabel,
  emptyLabel,
  closeLabel,
  tools,
  stripPrefix,
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim backdrop-blur-[1px]', SETTINGS_SHELL_OVERLAY_Z)}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 flex max-h-[min(88vh,40rem)] w-[min(100%-2rem,min(92vw,36rem))] -translate-x-1/2 -translate-y-1/2 flex-col',
            SETTINGS_SHELL_CONTENT_Z,
            'rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none dark:border-edge',
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-fg">
                <Wrench className="size-4 shrink-0 text-accent" aria-hidden />
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">
                {subtitle.replace('{{serverId}}', serverId).replace('{{count}}', String(tools.length))}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" className="size-8 shrink-0 px-0" aria-label={closeLabel}>
                <X className="size-4" aria-hidden />
              </Button>
            </Dialog.Close>
          </div>

          {tools.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <McpToolsListSearch
                key={`${serverId}-${open ? 'open' : 'closed'}`}
                tools={tools}
                stripPrefix={stripPrefix}
                searchPlaceholder={searchPlaceholder}
                searchEmptyLabel={searchEmptyLabel}
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <p className="text-sm text-fg-muted">{emptyLabel}</p>
            </div>
          )}

          <div className="flex justify-end border-t border-edge px-5 py-3">
            <Dialog.Close asChild>
              <Button type="button" variant="secondary">
                {closeLabel}
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
