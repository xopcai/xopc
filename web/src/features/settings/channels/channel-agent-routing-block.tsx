import { nativeSelectMaxWidthClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import type { ChannelsSettingsMessages } from '@/i18n/messages';

import { FieldHint, FieldLabel } from './field-primitives';
import { channelsInputClassName } from './utils';

export function ChannelAgentRoutingBlock({
  accountIds,
  routes,
  defaultAgentId,
  agentItems,
  disabled,
  onChange,
  ch,
}: {
  accountIds: string[];
  routes: Record<string, string>;
  defaultAgentId: string;
  agentItems: { id: string; name?: string }[];
  disabled?: boolean;
  onChange: (accountId: string, agentId: string) => void;
  ch: ChannelsSettingsMessages;
}) {
  if (accountIds.length === 0) return null;
  const opts = agentItems.length > 0 ? agentItems : [{ id: defaultAgentId }];
  return (
    <div className="space-y-3 border-t border-edge-subtle pt-4 dark:border-edge">
      <div>
        <FieldLabel>{ch.agentRoutingTitle}</FieldLabel>
        <FieldHint>{ch.agentRoutingHint}</FieldHint>
      </div>
      <div className="space-y-2">
        {accountIds.map((acc) => (
          <div
            key={acc}
            className="grid grid-cols-1 items-start gap-2 rounded-lg border border-edge-subtle bg-surface-base px-3 py-2.5 sm:grid-cols-2 sm:items-center dark:border-edge"
          >
            <div className="min-w-0">
              <p className="text-xs font-medium text-fg-muted">{ch.agentRoutingAccountLabel}</p>
              <p className="mt-0.5 truncate font-mono text-sm text-fg" title={acc}>
                {acc}
              </p>
            </div>
            <div className="min-w-0">
              <label className="sr-only" htmlFor={`agent-route-${acc}`}>
                {ch.agentRoutingAgentLabel}
              </label>
              <select
                id={`agent-route-${acc}`}
                className={cn(channelsInputClassName(), nativeSelectMaxWidthClass)}
                disabled={disabled}
                value={(routes[acc] ?? defaultAgentId).toLowerCase()}
                onChange={(e) => onChange(acc, e.target.value)}
              >
                {opts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name?.trim() ? `${a.name} (${a.id})` : a.id}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
