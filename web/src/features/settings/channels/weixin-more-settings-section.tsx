import { ChevronDown } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { ChatAgentsPayload } from '@/features/chat/chat-agents-api';
import type { ChannelsSettingsState, DmPolicy, StreamMode } from '@/features/settings/channels-config-api';
import { weixinRoutingAccountIds } from '@/features/settings/channel-bindings-merge';
import type { ChannelsSettingsMessages } from '@/i18n/messages';

import { ChannelPairingSection } from './channel-pairing-section';
import { SelectField } from './field-primitives';
import { scrollToChannelPairingSection } from './pairing-scroll';
import { WeixinAdvanced } from './weixin-advanced';

export function WeixinMoreSettingsSection({
  ch,
  wx,
  updateWeixin,
  dmOpts,
  streamOpts,
  wxAccountsDraft,
  setWxAccountsDraft,
  wxAccountsError,
  onWxAccountsBlur,
  form,
  chatAgents,
  onAgentRouteChange,
  saving,
  language,
  dialogOpen,
  pairingFocus = false,
}: {
  ch: ChannelsSettingsMessages;
  wx: ChannelsSettingsState['weixin'];
  updateWeixin: (patch: Partial<ChannelsSettingsState['weixin']>) => void;
  dmOpts: { value: DmPolicy; label: string }[];
  streamOpts: { value: StreamMode; label: string }[];
  wxAccountsDraft: string;
  setWxAccountsDraft: (v: string) => void;
  wxAccountsError: string;
  onWxAccountsBlur: () => void;
  form: ChannelsSettingsState;
  chatAgents: ChatAgentsPayload | undefined;
  onAgentRouteChange: (accountId: string, agentId: string) => void;
  saving: boolean;
  language: string;
  dialogOpen: boolean;
  pairingFocus?: boolean;
}) {
  const wxAccountIds = weixinRoutingAccountIds(wx);
  const resolvedWxAccounts = wxAccountIds.length > 0 ? wxAccountIds : ['default'];
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!pairingFocus) return;
    const details = detailsRef.current;
    if (details) details.open = true;
    const timer = window.setTimeout(() => scrollToChannelPairingSection('weixin'), 80);
    return () => window.clearTimeout(timer);
  }, [pairingFocus]);

  return (
    <details
      ref={detailsRef}
      className="group rounded-xl border border-edge-subtle bg-surface-base open:pb-3 dark:border-edge"
    >
      <summary className="cursor-pointer list-none rounded-xl px-3 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover group-open:rounded-b-none [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <ChevronDown className="size-4 shrink-0 text-fg-muted transition-transform group-open:rotate-180" />
          {ch.advancedShow}
        </span>
      </summary>
      <div className="space-y-4 border-t border-edge-subtle px-3 pb-3 pt-3 dark:border-edge-subtle">
        <p className="text-xs leading-relaxed text-fg-muted">{ch.weixinAdvancedHint}</p>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
          <input
            type="checkbox"
            className="ui-checkbox mt-0.5"
            checked={wx.enabled}
            onChange={(e) => updateWeixin({ enabled: e.target.checked })}
          />
          <span>{ch.enableWeixinAria}</span>
        </label>
        <SelectField label={ch.dmPolicy} value={wx.dmPolicy} onChange={(v) => updateWeixin({ dmPolicy: v })} options={dmOpts} />
        <ChannelPairingSection
          channel="weixin"
          accountIds={resolvedWxAccounts}
          channelConfig={wx}
          active={dialogOpen}
          ch={ch}
          language={language}
        />
        <div className="[&>div]:border-0 [&>div]:pt-0">
          <WeixinAdvanced
            wx={wx}
            updateWeixin={updateWeixin}
            ch={ch}
            streamOpts={streamOpts}
            wxAccountsDraft={wxAccountsDraft}
            setWxAccountsDraft={setWxAccountsDraft}
            wxAccountsError={wxAccountsError}
            onWxAccountsBlur={onWxAccountsBlur}
            channelAgentRoutesWx={form.channelAgentRoutes.weixin}
            defaultAgentId={form.defaultAgentId}
            agentItems={chatAgents?.items ?? []}
            onAgentRouteChange={onAgentRouteChange}
            routingDisabled={saving}
          />
        </div>
      </div>
    </details>
  );
}
