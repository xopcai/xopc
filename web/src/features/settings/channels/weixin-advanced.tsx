import type { ChannelsSettingsState, StreamMode } from '@/features/settings/channels-config-api';
import { weixinRoutingAccountIds } from '@/features/settings/channel-bindings-merge';
import { cn } from '@/lib/cn';
import type { ChannelsSettingsMessages } from '@/i18n/messages';

import { ChannelAgentRoutingBlock } from './channel-agent-routing-block';
import { FieldHint, FieldLabel, SelectField } from './field-primitives';
import { channelsInputClassName } from './utils';

export function WeixinAdvanced({
  wx,
  updateWeixin,
  ch,
  streamOpts,
  wxAccountsDraft,
  setWxAccountsDraft,
  wxAccountsError,
  onWxAccountsBlur,
  channelAgentRoutesWx,
  defaultAgentId,
  agentItems,
  onAgentRouteChange,
  routingDisabled,
}: {
  wx: ChannelsSettingsState['weixin'];
  updateWeixin: (p: Partial<ChannelsSettingsState['weixin']>) => void;
  ch: ChannelsSettingsMessages;
  streamOpts: { value: StreamMode; label: string }[];
  wxAccountsDraft: string;
  setWxAccountsDraft: (s: string) => void;
  wxAccountsError: string;
  onWxAccountsBlur: () => void;
  channelAgentRoutesWx: Record<string, string>;
  defaultAgentId: string;
  agentItems: { id: string; name?: string }[];
  onAgentRouteChange: (accountId: string, agentId: string) => void;
  routingDisabled: boolean;
}) {
  const inputClassName = channelsInputClassName;
  return (
    <div className="space-y-4 border-t border-edge-subtle pt-4 dark:border-edge">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.weixinAllowFrom}</FieldLabel>
        <textarea
          className={cn(inputClassName(), 'min-h-[2.75rem] resize-y font-mono text-xs')}
          rows={2}
          placeholder="wxid_..., openid_..."
          value={wx.allowFrom.join(', ')}
          onChange={(e) =>
            updateWeixin({
              allowFrom: e.target.value
                .split(/[,\n]/)
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
        <FieldHint>{ch.weixinAllowFromDesc}</FieldHint>
      </div>
      <SelectField
        label={ch.streamMode}
        value={wx.streamMode}
        onChange={(v) => updateWeixin({ streamMode: v })}
        options={streamOpts}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{ch.historyLimit}</FieldLabel>
          <input
            type="number"
            min={10}
            max={200}
            className={inputClassName()}
            value={wx.historyLimit}
            onChange={(e) => updateWeixin({ historyLimit: parseInt(e.target.value, 10) || 50 })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{ch.textChunkLimit}</FieldLabel>
          <input
            type="number"
            min={1000}
            max={10000}
            step={100}
            className={inputClassName()}
            value={wx.textChunkLimit}
            onChange={(e) => updateWeixin({ textChunkLimit: parseInt(e.target.value, 10) || 4000 })}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.weixinRouteTag}</FieldLabel>
        <input
          className={inputClassName()}
          value={wx.routeTag}
          onChange={(e) => updateWeixin({ routeTag: e.target.value })}
          placeholder={ch.routeTagPlaceholder}
        />
        <FieldHint>{ch.weixinRouteTagDesc}</FieldHint>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={wx.debug}
          onChange={(e) => updateWeixin({ debug: e.target.checked })}
        />
        {ch.weixinDebug}
      </label>
      <FieldHint>{ch.weixinDebugDesc}</FieldHint>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.weixinAccountsJson}</FieldLabel>
        <textarea
          className={cn(inputClassName(), 'min-h-[140px] resize-y font-mono text-xs')}
          spellCheck={false}
          value={wxAccountsDraft}
          onChange={(e) => setWxAccountsDraft(e.target.value)}
          onBlur={onWxAccountsBlur}
          placeholder='{ "personal": { "name": "...", "cdnBaseUrl": "...", "enabled": true } }'
        />
        {wxAccountsError ? (
          <p className="text-xs text-red-600 dark:text-red-400">{wxAccountsError}</p>
        ) : (
          <FieldHint>{ch.weixinAccountsJsonDesc}</FieldHint>
        )}
      </div>

      <ChannelAgentRoutingBlock
        accountIds={weixinRoutingAccountIds(wx)}
        routes={channelAgentRoutesWx}
        defaultAgentId={defaultAgentId}
        agentItems={agentItems}
        disabled={routingDisabled}
        onChange={onAgentRouteChange}
        ch={ch}
      />
    </div>
  );
}
