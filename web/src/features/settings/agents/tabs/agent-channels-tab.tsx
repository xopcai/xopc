import { Link2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { GatewayConfigBinding } from '@/features/settings/agents-admin-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { agentsSettingsInputClass, matchSummary } from '../utils';
import type { AgentsSettingsMessages } from '@/i18n/messages';

export function AgentChannelsTab(props: {
  a: AgentsSettingsMessages;
  busy: boolean;
  bindingsLoading: boolean;
  agentBindings: GatewayConfigBinding[];
  newBindChannel: string;
  setNewBindChannel: (v: string) => void;
  newBindPeerId: string;
  setNewBindPeerId: (v: string) => void;
  onRemoveBinding: (rule: GatewayConfigBinding) => void;
  onAddBinding: (e: React.FormEvent) => void;
}) {
  const {
    a,
    busy,
    bindingsLoading,
    agentBindings,
    newBindChannel,
    setNewBindChannel,
    newBindPeerId,
    setNewBindPeerId,
    onRemoveBinding,
    onAddBinding,
  } = props;

  return (
    <SettingsFormSection className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <SettingsFormSectionHeader
        className="shrink-0"
        icon={Link2}
        title={a.channelsTitle}
        subtitle={a.channelsHint}
      />
      {bindingsLoading ? (
        <p className="text-sm text-fg-muted">{a.channelsLoading}</p>
      ) : agentBindings.length === 0 ? (
        <p className="text-sm text-fg-muted">{a.channelsNone}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {agentBindings.map((b, i) => (
            <li
              key={`${b.match.channel}-${i}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-surface-panel px-3 py-2"
            >
              <span className="font-mono text-xs">{matchSummary(b.match)}</span>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void onRemoveBinding(b)}>
                {a.removeBinding}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form className="mt-4 grid gap-2 sm:grid-cols-2" onSubmit={onAddBinding}>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-fg-muted">{a.channelLabel}</span>
          <input
            className={agentsSettingsInputClass()}
            value={newBindChannel}
            onChange={(e) => setNewBindChannel(e.target.value)}
            placeholder="telegram"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-fg-muted">{a.peerIdLabel}</span>
          <input
            className={agentsSettingsInputClass()}
            value={newBindPeerId}
            onChange={(e) => setNewBindPeerId(e.target.value)}
          />
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy || !newBindChannel.trim()}>
            {a.addBinding}
          </Button>
        </div>
      </form>
    </SettingsFormSection>
  );
}
