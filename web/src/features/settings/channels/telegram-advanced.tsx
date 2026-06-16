import type {
  ChannelsSettingsState,
  GroupPolicy,
  ReplyToMode,
  StreamMode,
  TelegramReactionLevel,
  TelegramReactionNotifications,
} from '@/features/settings/channels-config-api';
import { cn } from '@/lib/cn';
import type { ChannelsSettingsMessages } from '@/i18n/messages';

import { FieldHint, FieldLabel, SelectField } from './field-primitives';
import { channelsInputClassName, joinAllowFrom, parseIdList } from './utils';

export function TelegramAdvanced({
  tg,
  updateTelegram,
  ch,
  groupOpts,
  replyOpts,
  streamOpts,
  reactionLevelOpts,
  reactionNotifyOpts,
  tgAccountsDraft,
  setTgAccountsDraft,
  tgAccountsError,
  onTgAccountsBlur,
}: {
  tg: ChannelsSettingsState['telegram'];
  updateTelegram: (p: Partial<ChannelsSettingsState['telegram']>) => void;
  ch: ChannelsSettingsMessages;
  groupOpts: { value: GroupPolicy; label: string }[];
  replyOpts: { value: ReplyToMode; label: string }[];
  streamOpts: { value: StreamMode; label: string }[];
  reactionLevelOpts: { value: TelegramReactionLevel; label: string }[];
  reactionNotifyOpts: { value: TelegramReactionNotifications; label: string }[];
  tgAccountsDraft: string;
  setTgAccountsDraft: (s: string) => void;
  tgAccountsError: string;
  onTgAccountsBlur: () => void;
}) {
  const inputClassName = channelsInputClassName;
  return (
    <div className="space-y-4 border-t border-edge-subtle pt-4 dark:border-edge">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.apiRoot}</FieldLabel>
        <input
          className={inputClassName()}
          value={tg.apiRoot}
          onChange={(e) => updateTelegram({ apiRoot: e.target.value })}
          placeholder="https://api.telegram.org"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.proxy}</FieldLabel>
        <input
          className={inputClassName()}
          value={tg.proxy}
          onChange={(e) => updateTelegram({ proxy: e.target.value })}
          placeholder="http://proxy.example.com:8080"
        />
      </div>
      <SelectField
        label={ch.groupPolicy}
        value={tg.groupPolicy}
        onChange={(v) => updateTelegram({ groupPolicy: v })}
        options={groupOpts}
      />
      <SelectField
        label={ch.replyToMode}
        value={tg.replyToMode}
        onChange={(v) => updateTelegram({ replyToMode: v })}
        options={replyOpts}
      />
      <SelectField
        label={ch.streamMode}
        value={tg.streamMode}
        onChange={(v) => updateTelegram({ streamMode: v })}
        options={streamOpts}
      />
      <SelectField
        label={ch.telegramReactionLevel}
        value={tg.reactionLevel ?? 'ack'}
        onChange={(v) => updateTelegram({ reactionLevel: v })}
        options={reactionLevelOpts}
      />
      <SelectField
        label={ch.telegramReactionNotifications}
        value={tg.reactionNotifications ?? 'own'}
        onChange={(v) => updateTelegram({ reactionNotifications: v })}
        options={reactionNotifyOpts}
      />
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.telegramAckReaction}</FieldLabel>
        <input
          className={inputClassName()}
          value={tg.ackReaction ?? ''}
          onChange={(e) => updateTelegram({ ackReaction: e.target.value })}
          placeholder="👀"
        />
        <FieldHint>{ch.telegramAckReactionDesc}</FieldHint>
      </div>
      <div className="space-y-3 rounded-lg border border-edge-subtle p-3 dark:border-edge">
        <p className="text-sm font-medium text-fg">{ch.telegramExecApprovalsTitle}</p>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            className="ui-checkbox"
            checked={tg.execApprovalsEnabled ?? false}
            onChange={(e) => updateTelegram({ execApprovalsEnabled: e.target.checked })}
          />
          {ch.telegramExecApprovalsEnabled}
        </label>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{ch.telegramExecApprovers}</FieldLabel>
          <textarea
            className={cn(inputClassName(), 'min-h-[2.75rem] resize-y font-mono text-xs')}
            rows={2}
            placeholder="123456789"
            value={tg.execApprovalsApprovers ?? ''}
            onChange={(e) => updateTelegram({ execApprovalsApprovers: e.target.value })}
          />
          <FieldHint>{ch.telegramExecApproversDesc}</FieldHint>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.allowFromGroups}</FieldLabel>
        <textarea
          className={cn(inputClassName(), 'min-h-[2.75rem] resize-y font-mono text-xs')}
          rows={2}
          placeholder="-1001234567890"
          value={joinAllowFrom(tg.groupAllowFrom)}
          onChange={(e) => updateTelegram({ groupAllowFrom: parseIdList(e.target.value) })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{ch.historyLimit}</FieldLabel>
          <input
            type="number"
            min={10}
            max={200}
            className={inputClassName()}
            value={tg.historyLimit}
            onChange={(e) => updateTelegram({ historyLimit: parseInt(e.target.value, 10) || 50 })}
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
            value={tg.textChunkLimit}
            onChange={(e) => updateTelegram({ textChunkLimit: parseInt(e.target.value, 10) || 4000 })}
          />
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={tg.debug}
          onChange={(e) => updateTelegram({ debug: e.target.checked })}
        />
        {ch.telegramDebug}
      </label>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.multiAccountJson}</FieldLabel>
        <textarea
          className={cn(inputClassName(), 'min-h-[140px] resize-y font-mono text-xs')}
          spellCheck={false}
          value={tgAccountsDraft}
          onChange={(e) => setTgAccountsDraft(e.target.value)}
          onBlur={onTgAccountsBlur}
          placeholder='{ "personal": { "botToken": "...", ... } }'
        />
        {tgAccountsError ? (
          <p className="text-xs text-red-600 dark:text-red-400">{tgAccountsError}</p>
        ) : (
          <FieldHint>{ch.multiAccountJsonDesc}</FieldHint>
        )}
      </div>
    </div>
  );
}
