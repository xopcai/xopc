import { useEffect, useState } from 'react';
import { Check, ChevronDown, Copy, Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ChatAgentsPayload } from '@/features/chat/agent-selection/chat-agents-api';
import { telegramRoutingAccountIds } from '@/features/settings/channel-bindings-merge';
import {
  emptyTelegramAccount,
  type ChannelsSettingsState,
  type DmPolicy,
  type GroupPolicy,
  type ReplyToMode,
  type StreamMode,
} from '@/features/settings/channels-config-api';
import type { ChannelsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import { ChannelAgentRoutingBlock } from './channel-agent-routing-block';
import { ChannelPairingSection } from './channel-pairing-section';
import { ChannelPairingSetupSteps } from './channel-pairing-setup-steps';
import { channelUsesPairingPolicy } from './pairing-policy';
import { FieldHint, FieldLabel, SelectField } from './field-primitives';
import { TelegramAdvanced } from './telegram-advanced';
import { ChannelsSettingsDialogFooter } from './channels-settings-dialog-footer';
import { ChannelSettingsShell, type ChannelSettingsPresentation } from './channel-settings-shell';
import { scrollToChannelPairingSection } from './pairing-scroll';
import { channelsInputClassName, joinAllowFrom, parseIdList, telegramDefaultBotToken } from './utils';

export function TelegramChannelSettingsDialog({
  open,
  onOpenChange,
  presentation = 'modal',
  ch,
  form,
  baseline,
  tgAdvanced,
  setTgAdvanced,
  showToken,
  setShowToken,
  copied,
  copyToken,
  updateTelegram,
  updateChannelAgentRoute,
  tgAccountsDraft,
  setTgAccountsDraft,
  tgAccountsError,
  onTgAccountsBlur,
  dmOpts,
  groupOpts,
  replyOpts,
  streamOpts,
  chatAgents,
  saving,
  dirty,
  save,
  discard,
  language,
  scrollToPairingOnOpen = false,
  closeOnSave = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presentation?: ChannelSettingsPresentation;
  ch: ChannelsSettingsMessages;
  form: ChannelsSettingsState;
  baseline: ChannelsSettingsState | null;
  tgAdvanced: boolean;
  setTgAdvanced: (v: boolean | ((b: boolean) => boolean)) => void;
  showToken: boolean;
  setShowToken: (v: boolean | ((b: boolean) => boolean)) => void;
  copied: boolean;
  copyToken: () => Promise<void>;
  updateTelegram: (patch: Partial<ChannelsSettingsState['telegram']>) => void;
  updateChannelAgentRoute: (channel: 'telegram', accountId: string, agentId: string) => void;
  tgAccountsDraft: string;
  setTgAccountsDraft: (s: string) => void;
  tgAccountsError: string;
  onTgAccountsBlur: () => void;
  dmOpts: { value: DmPolicy; label: string }[];
  groupOpts: { value: GroupPolicy; label: string }[];
  replyOpts: { value: ReplyToMode; label: string }[];
  streamOpts: { value: StreamMode; label: string }[];
  chatAgents: ChatAgentsPayload | undefined;
  saving: boolean;
  dirty: boolean;
  save: () => Promise<boolean>;
  discard: () => void;
  language: string;
  scrollToPairingOnOpen?: boolean;
  closeOnSave?: boolean;
}) {
  const inputClassName = channelsInputClassName;
  const tg = form.telegram;
  const tgBaselineToken = baseline ? telegramDefaultBotToken(baseline.telegram) : '';
  const tgToken = telegramDefaultBotToken(tg);
  const telegramTokenDisplayLocked =
    !showToken && Boolean(String(tgBaselineToken).trim()) && tgToken === tgBaselineToken;
  const [pairedCredentialCount, setPairedCredentialCount] = useState(0);
  const tokenReady = Boolean(tgToken.trim()) && tg.enabled;
  const tgAccountIds = telegramRoutingAccountIds(tg);

  useEffect(() => {
    if (!open || !scrollToPairingOnOpen) return;
    const timer = window.setTimeout(() => scrollToChannelPairingSection('telegram'), 80);
    return () => window.clearTimeout(timer);
  }, [open, scrollToPairingOnOpen]);

  return (
    <ChannelSettingsShell
      presentation={presentation}
      open={open}
      onOpenChange={onOpenChange}
      title={ch.telegramTitle}
      description={ch.telegramSubtitle}
      srTitle={ch.telegramTitle}
      srDescription={ch.telegramSubtitle}
      closeAriaLabel={ch.modalCancel}
      wide
      headerExtra={
        presentation === 'modal' ? (
          <div className="border-b border-edge-subtle px-6 pb-4 pt-6 dark:border-edge-subtle">
            <h2 className="text-lg font-semibold tracking-tight text-fg">{ch.telegramTitle}</h2>
            <p className="mt-1 text-sm text-fg-muted">{ch.telegramSubtitle}</p>
          </div>
        ) : undefined
      }
      footer={
        <ChannelsSettingsDialogFooter
          ch={ch}
          dirty={dirty}
          saving={saving}
          onCancel={() => onOpenChange(false)}
          onDiscard={discard}
          onSave={async () => {
            const ok = await save();
            if (ok && closeOnSave) onOpenChange(false);
          }}
        />
      }
    >
      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              className="ui-checkbox"
              checked={tg.enabled}
              onChange={(e) => updateTelegram({ enabled: e.target.checked })}
            />
            <span>{ch.enableTelegramAria}</span>
          </label>

          <div className="mt-6 space-y-4">
            <div className="flex flex-col gap-1.5">
              <FieldLabel>
                {ch.telegramToken}
                <span className="text-red-600 dark:text-red-400"> *</span>
              </FieldLabel>
              <div className="flex flex-wrap gap-2">
                <input
                  className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                  type={showToken ? 'text' : 'password'}
                  autoComplete="off"
                  readOnly={telegramTokenDisplayLocked}
                  value={
                    telegramTokenDisplayLocked
                      ? '*'.repeat(Math.max(1, tgBaselineToken.length))
                      : tgToken
                  }
                  onChange={(e) => {
                    if (telegramTokenDisplayLocked) return;
                    const prev = tg.accounts?.default ?? emptyTelegramAccount('default');
                    updateTelegram({
                      accounts: {
                        ...tg.accounts,
                        default: { ...prev, accountId: 'default', botToken: e.target.value },
                      },
                    });
                  }}
                  placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                />
                {tgToken ? (
                  <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => void copyToken()}>
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? ch.copied : ch.copy}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  className="px-2 py-1 text-xs"
                  onClick={() => setShowToken((s) => !s)}
                >
                  {showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  {showToken ? ch.hide : ch.show}
                </Button>
              </div>
              <FieldHint>{ch.telegramTokenDesc}</FieldHint>
            </div>

            <ChannelPairingSetupSteps
              ch={ch}
              usesPairing={channelUsesPairingPolicy('telegram', tg)}
              tokenReady={tokenReady}
              pairingComplete={pairedCredentialCount > 0}
            />

            <SelectField
              label={ch.dmPolicy}
              value={tg.dmPolicy}
              onChange={(v) => updateTelegram({ dmPolicy: v })}
              options={dmOpts}
            />

            <ChannelPairingSection
              channel="telegram"
              accountIds={tgAccountIds}
              channelConfig={tg}
              active={open}
              ch={ch}
              language={language}
              onPairedChange={setPairedCredentialCount}
            />

            <div className="flex flex-col gap-1.5">
              <FieldLabel>{ch.allowFromDm}</FieldLabel>
              <textarea
                className={cn(inputClassName(), 'min-h-[2.75rem] resize-y font-mono text-xs')}
                rows={2}
                placeholder="123456789, 987654321"
                value={joinAllowFrom(tg.allowFrom)}
                onChange={(e) => updateTelegram({ allowFrom: parseIdList(e.target.value) })}
              />
              <FieldHint>{ch.allowFromDmDesc}</FieldHint>
            </div>

            <ChannelAgentRoutingBlock
              accountIds={telegramRoutingAccountIds(tg)}
              routes={form.channelAgentRoutes.telegram}
              defaultAgentId={form.defaultAgentId}
              agentItems={chatAgents?.items ?? []}
              disabled={saving}
              onChange={(acc, aid) => updateChannelAgentRoute('telegram', acc, aid)}
              ch={ch}
            />

            <Button
              type="button"
              variant="ghost"
              className="-ml-2 h-auto justify-start px-2 py-1 text-sm text-fg-muted hover:text-fg"
              onClick={() => setTgAdvanced((a) => !a)}
            >
              <ChevronDown className={cn('mr-1 size-4 transition-transform', tgAdvanced && 'rotate-180')} />
              {tgAdvanced ? ch.advancedHide : ch.advancedShow}
            </Button>

            {tgAdvanced ? (
              <TelegramAdvanced
                tg={tg}
                updateTelegram={updateTelegram}
                ch={ch}
                groupOpts={groupOpts}
                replyOpts={replyOpts}
                streamOpts={streamOpts}
                tgAccountsDraft={tgAccountsDraft}
                setTgAccountsDraft={setTgAccountsDraft}
                tgAccountsError={tgAccountsError}
                onTgAccountsBlur={onTgAccountsBlur}
              />
            ) : null}
          </div>
    </ChannelSettingsShell>
  );
}
