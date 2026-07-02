import { Link2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { GatewayConfigBinding } from '@/features/settings/agents-admin-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import type { ChannelStatus, SessionChatId } from '@/features/settings/channel-recipient-api';
import { formatRecipientOptionLabel } from '@/features/settings/channel-recipient-api';
import { selectControlBaseClass } from '@/lib/form-field-width';
import { agentsSettingsInputClass, matchSummary } from '../utils';
import type { AgentsSettingsMessages, MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';

const channelsPeerIdSelectClass = cn(
  selectControlBaseClass,
  'w-full text-xs sm:w-auto sm:min-w-[11rem] sm:max-w-[17rem] sm:shrink-0',
);

type LastActiveLabels = MessageBundle['cron']['lastActiveLabels'];

export function AgentChannelsTab(props: {
  a: AgentsSettingsMessages;
  busy: boolean;
  bindingsLoading: boolean;
  agentBindings: GatewayConfigBinding[];
  onRemoveBinding: (rule: GatewayConfigBinding) => void;
  onAddBinding: (e: React.FormEvent) => void;
  channelStatuses: ChannelStatus[];
  channelsStatusLoading: boolean;
  useManualChannel: boolean;
  newBindChannel: string;
  setNewBindChannel: (v: string) => void;
  bindSessionChats: SessionChatId[];
  sessionsLoading: boolean;
  newBindSessionIdx: number | null;
  setNewBindSessionIdx: (v: number | null) => void;
  newBindCustomPeer: string;
  setNewBindCustomPeer: (v: string) => void;
  onRefreshSessions: () => void;
  lastActiveLabels: LastActiveLabels;
  /** Same copy as `cron.selectRecipient` — empty option in peer id dropdown. */
  selectRecipient: string;
}) {
  const {
    a,
    busy,
    bindingsLoading,
    agentBindings,
    onRemoveBinding,
    onAddBinding,
    channelStatuses,
    channelsStatusLoading,
    useManualChannel,
    newBindChannel,
    setNewBindChannel,
    bindSessionChats,
    sessionsLoading,
    newBindSessionIdx,
    setNewBindSessionIdx,
    newBindCustomPeer,
    setNewBindCustomPeer,
    onRefreshSessions,
    lastActiveLabels,
    selectRecipient,
  } = props;

  const showPeerForm = !channelsStatusLoading && (useManualChannel || channelStatuses.length > 0);

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
          {agentBindings.map((b) => (
            <li
              key={`${b.match.channel}-${matchSummary(b.match)}`}
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
      <form className="mt-4 flex flex-col gap-3" onSubmit={onAddBinding}>
        {channelsStatusLoading ? (
          <p className="text-sm text-fg-muted">{a.channelsLoadingChannels}</p>
        ) : useManualChannel ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg-muted">{a.channelLabel}</span>
            <input
              className={agentsSettingsInputClass()}
              value={newBindChannel}
              onChange={(e) => setNewBindChannel(e.target.value)}
              placeholder="telegram"
              autoComplete="off"
            />
            <p className="text-xs text-fg-muted">{a.channelsManualChannelHint}</p>
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg-muted">{a.channelLabel}</span>
            <select
              className={cn(agentsSettingsInputClass(), 'py-2')}
              value={newBindChannel}
              onChange={(e) => {
                setNewBindChannel(e.target.value);
                setNewBindSessionIdx(null);
                setNewBindCustomPeer('');
              }}
            >
              {channelStatuses.map((ch) => (
                <option key={ch.name} value={ch.name} disabled={!ch.enabled}>
                  {ch.name} {!ch.enabled ? a.channelsDisabledSuffix : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        {showPeerForm && newBindChannel.trim() ? (
          <div className="flex flex-col gap-2 border-t border-edge-subtle pt-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-fg-muted">{a.channelsSessionLabel}</span>
              <Button
                type="button"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs"
                disabled={busy || sessionsLoading || !newBindChannel.trim()}
                title={a.channelsRefreshSessionsHint}
                onClick={() => onRefreshSessions()}
              >
                <RefreshCw className={cn('size-3.5', sessionsLoading && 'animate-spin')} strokeWidth={1.75} />
                {a.channelsRefreshSessions}
              </Button>
            </div>
            {sessionsLoading && bindSessionChats.length === 0 ? (
              <p className="text-xs text-fg-muted">{a.channelsLoadingSessions}</p>
            ) : null}
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted">{a.channelsPeerFromSessions}</span>
              <select
                className={cn(agentsSettingsInputClass(), 'py-2')}
                value={newBindSessionIdx == null ? '' : String(newBindSessionIdx)}
                disabled={busy || !newBindChannel.trim() || Boolean(newBindCustomPeer.trim())}
                onChange={(e) => {
                  const v = e.target.value;
                  setNewBindSessionIdx(v === '' ? null : Number(v));
                }}
              >
                <option value="">{a.channelsPeerAny}</option>
                {bindSessionChats.map((item, idx) => (
                  <option key={`${item.channel}-${item.chatId}`} value={String(idx)}>
                    {formatRecipientOptionLabel(item, lastActiveLabels)}
                  </option>
                ))}
              </select>
            </label>
            {bindSessionChats.length === 0 && newBindChannel.trim() && !sessionsLoading ? (
              <p className="text-xs text-fg-muted">{a.channelsNoSessionsHint}</p>
            ) : null}
            <div className="flex flex-col gap-1">
              <span className="text-fg-muted">{a.peerIdLabel}</span>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-2">
                <input
                  type="text"
                  className={cn(agentsSettingsInputClass(), 'min-w-0 w-full sm:flex-1')}
                  value={newBindCustomPeer}
                  onChange={(e) => {
                    setNewBindCustomPeer(e.target.value);
                    if (e.target.value.trim()) {
                      setNewBindSessionIdx(null);
                    }
                  }}
                  placeholder={a.channelsCustomPeerPlaceholder}
                  autoComplete="off"
                />
                <select
                  className={channelsPeerIdSelectClass}
                  value={newBindCustomPeer}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) {
                      setNewBindCustomPeer(v);
                    } else {
                      setNewBindCustomPeer('');
                    }
                    setNewBindSessionIdx(null);
                  }}
                >
                  <option value="">{selectRecipient}</option>
                  {bindSessionChats.map((item) => (
                    <option key={`${item.channel}-${item.chatId}`} value={item.chatId}>
                      {formatRecipientOptionLabel(item, lastActiveLabels)}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-fg-muted">{a.channelsCustomPeerHint}</p>
            </div>
          </div>
        ) : null}

        <div>
          <Button type="submit" disabled={busy || !newBindChannel.trim() || channelsStatusLoading}>
            {a.addBinding}
          </Button>
        </div>
      </form>
    </SettingsFormSection>
  );
}
