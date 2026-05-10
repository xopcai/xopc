import * as Dialog from '@radix-ui/react-dialog';
import { Check, ChevronDown, Copy, Eye, EyeOff, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ChatAgentsPayload } from '@/features/chat/chat-agents-api';
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
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';

import { ChannelAgentRoutingBlock } from './channel-agent-routing-block';
import { FieldHint, FieldLabel } from './field-primitives';
import { TelegramAdvanced } from './telegram-advanced';
import { channelsInputClassName, joinAllowFrom, parseIdList, telegramDefaultBotToken } from './utils';

export function TelegramChannelSettingsDialog({
  open,
  onOpenChange,
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
}) {
  const inputClassName = channelsInputClassName;
  const tg = form.telegram;
  const tgBaselineToken = baseline ? telegramDefaultBotToken(baseline.telegram) : '';
  const tgToken = telegramDefaultBotToken(tg);
  const telegramTokenDisplayLocked =
    !showToken && Boolean(String(tgBaselineToken).trim()) && tgToken === tgBaselineToken;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'xopc-dialog-overlay fixed inset-0 bg-scrim backdrop-blur-[1px]',
            SETTINGS_SHELL_OVERLAY_Z,
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 max-h-[min(90vh,48rem)] w-[min(100%-2rem,36rem)] -translate-x-1/2 -translate-y-1/2',
            SETTINGS_SHELL_CONTENT_Z,
            'overflow-y-auto rounded-2xl border border-edge bg-surface-panel p-6 shadow-popover outline-none dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold tracking-tight text-fg">{ch.telegramTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">{ch.telegramSubtitle}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label={ch.modalCancel}
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <label className="mt-6 flex cursor-pointer items-center gap-2 text-sm text-fg">
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
                dmOpts={dmOpts}
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

          <div className="mt-8 flex flex-wrap justify-end gap-2 border-t border-edge-subtle pt-4 dark:border-edge-subtle">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {ch.modalCancel}
            </Button>
            <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={discard}>
              {ch.discard}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!dirty || saving}
              onClick={async () => {
                const ok = await save();
                if (ok) onOpenChange(false);
              }}
            >
              {saving ? ch.saving : ch.save}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
