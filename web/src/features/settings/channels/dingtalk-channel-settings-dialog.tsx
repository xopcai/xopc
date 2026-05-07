import * as Dialog from '@radix-ui/react-dialog';
import { Check, Copy, Eye, EyeOff, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ChatAgentsPayload } from '@/features/chat/chat-agents-api';
import { dingtalkRoutingAccountIds } from '@/features/settings/channel-bindings-merge';
import type { ChannelsSettingsState, DmPolicy, GroupPolicy } from '@/features/settings/channels-config-api';
import { cn } from '@/lib/cn';
import type { ChannelsSettingsMessages } from '@/i18n/messages';

import { ChannelAgentRoutingBlock } from './channel-agent-routing-block';
import { FieldHint, FieldLabel } from './field-primitives';
import { channelsInputClassName, isDingtalkConfigured, joinAllowFrom, parseIdList } from './utils';

export function DingtalkChannelSettingsDialog({
  open,
  onOpenChange,
  ch,
  form,
  baseline,
  showDingtalkSecret,
  setShowDingtalkSecret,
  dingtalkCopied,
  copyDingtalkSecret,
  updateDingtalk,
  updateChannelAgentRoute,
  dingtalkAccountsDraft,
  setDingtalkAccountsDraft,
  dingtalkAccountsError,
  onDingtalkAccountsBlur,
  dmOpts,
  groupOpts,
  chatAgents,
  saving,
  dirty,
  save,
  onOpenQrSetup,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ch: ChannelsSettingsMessages;
  form: ChannelsSettingsState;
  baseline: ChannelsSettingsState | null;
  showDingtalkSecret: boolean;
  setShowDingtalkSecret: (v: boolean | ((b: boolean) => boolean)) => void;
  dingtalkCopied: boolean;
  copyDingtalkSecret: () => Promise<void>;
  updateDingtalk: (patch: Partial<ChannelsSettingsState['dingtalk']>) => void;
  updateChannelAgentRoute: (
    channel: 'telegram' | 'weixin' | 'feishu' | 'dingtalk',
    accountId: string,
    agentId: string,
  ) => void;
  dingtalkAccountsDraft: string;
  setDingtalkAccountsDraft: (s: string) => void;
  dingtalkAccountsError: string;
  onDingtalkAccountsBlur: () => void;
  dmOpts: { value: DmPolicy; label: string }[];
  groupOpts: { value: GroupPolicy; label: string }[];
  chatAgents: ChatAgentsPayload | undefined;
  saving: boolean;
  dirty: boolean;
  save: () => Promise<boolean>;
  onOpenQrSetup: () => void;
}) {
  const inputClassName = channelsInputClassName;
  const dt = form.dingtalk;
  const dingtalkBaselineSecret = baseline?.dingtalk?.clientSecret ?? '';
  const dingtalkSecretDisplayLocked =
    !showDingtalkSecret &&
    Boolean(String(dingtalkBaselineSecret).trim()) &&
    dt.clientSecret === dingtalkBaselineSecret;
  const dingtalkConfigured = isDingtalkConfigured(dt);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[60] max-h-[min(90vh,48rem)] w-[min(100%-2rem,36rem)] -translate-x-1/2 -translate-y-1/2',
            'overflow-y-auto rounded-2xl border border-edge bg-surface-panel p-6 shadow-popover outline-none dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold tracking-tight text-fg">{ch.dingtalkTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">{ch.dingtalkSubtitle}</Dialog.Description>
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
              checked={dt.enabled}
              onChange={(e) => updateDingtalk({ enabled: e.target.checked })}
            />
            <span>{ch.enableDingtalkAria}</span>
          </label>

          {!dingtalkConfigured ? (
            <div className="mt-6 rounded-xl border border-dashed border-accent/40 bg-accent/5 px-4 py-3 dark:bg-accent/10">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-fg">{ch.dingtalkQrSetupTitle}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">{ch.dingtalkQrSetupDesc}</p>
                </div>
                <Button type="button" variant="primary" className="shrink-0" onClick={onOpenQrSetup}>
                  {ch.dingtalkQrSetupButton}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="mt-6 space-y-4">
            <div className="flex flex-col gap-1.5">
              <FieldLabel>
                {ch.dingtalkClientId}
                <span className="text-red-600 dark:text-red-400"> *</span>
              </FieldLabel>
              <input
                className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                value={dt.clientId}
                onChange={(e) => updateDingtalk({ clientId: e.target.value })}
                placeholder="dingxxx"
              />
              <FieldHint>{ch.dingtalkClientIdDesc}</FieldHint>
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel>
                {ch.dingtalkClientSecret}
                <span className="text-red-600 dark:text-red-400"> *</span>
              </FieldLabel>
              <div className="flex flex-wrap gap-2">
                <input
                  className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                  type={showDingtalkSecret ? 'text' : 'password'}
                  autoComplete="off"
                  readOnly={dingtalkSecretDisplayLocked}
                  value={
                    dingtalkSecretDisplayLocked
                      ? '*'.repeat(Math.max(1, dt.clientSecret.length))
                      : dt.clientSecret
                  }
                  onChange={(e) => {
                    if (dingtalkSecretDisplayLocked) return;
                    updateDingtalk({ clientSecret: e.target.value });
                  }}
                  placeholder="••••••••"
                />
                {dt.clientSecret ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={() => void copyDingtalkSecret()}
                  >
                    {dingtalkCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {dingtalkCopied ? ch.copied : ch.copy}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  className="px-2 py-1 text-xs"
                  onClick={() => setShowDingtalkSecret((s) => !s)}
                >
                  {showDingtalkSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  {showDingtalkSecret ? ch.hide : ch.show}
                </Button>
              </div>
              <FieldHint>{ch.dingtalkClientSecretDesc}</FieldHint>
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel>{ch.dingtalkEndpoint}</FieldLabel>
              <input
                className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                value={dt.endpoint}
                onChange={(e) => updateDingtalk({ endpoint: e.target.value })}
                placeholder="https://api.dingtalk.com"
              />
              <FieldHint>{ch.dingtalkEndpointDesc}</FieldHint>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={dt.debug}
                onChange={(e) => updateDingtalk({ debug: e.target.checked })}
              />
              {ch.dingtalkDebug}
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{ch.dmPolicy}</FieldLabel>
                <select
                  className={inputClassName()}
                  value={dt.dmPolicy}
                  onChange={(e) =>
                    updateDingtalk({ dmPolicy: e.target.value as ChannelsSettingsState['dingtalk']['dmPolicy'] })
                  }
                >
                  {dmOpts.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{ch.groupPolicy}</FieldLabel>
                <select
                  className={inputClassName()}
                  value={dt.groupPolicy}
                  onChange={(e) =>
                    updateDingtalk({
                      groupPolicy: e.target.value as ChannelsSettingsState['dingtalk']['groupPolicy'],
                    })
                  }
                >
                  {groupOpts.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={dt.requireMention}
                onChange={(e) => updateDingtalk({ requireMention: e.target.checked })}
              />
              {ch.requireMention}
            </label>

            <div className="flex flex-col gap-1.5">
              <FieldLabel>{ch.allowFromDm}</FieldLabel>
              <textarea
                className={cn(inputClassName(), 'min-h-[2.75rem] resize-y font-mono text-xs')}
                rows={2}
                placeholder="userId1, userId2"
                value={joinAllowFrom(dt.allowFrom)}
                onChange={(e) => updateDingtalk({ allowFrom: parseIdList(e.target.value) })}
              />
              <FieldHint>{ch.allowFromDmDesc}</FieldHint>
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel>{ch.allowFromGroups}</FieldLabel>
              <textarea
                className={cn(inputClassName(), 'min-h-[2.75rem] resize-y font-mono text-xs')}
                rows={2}
                placeholder="openConversationId1"
                value={joinAllowFrom(dt.groupAllowFrom)}
                onChange={(e) => updateDingtalk({ groupAllowFrom: parseIdList(e.target.value) })}
              />
              <FieldHint>{ch.allowFromGroupsDesc}</FieldHint>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{ch.historyLimit}</FieldLabel>
                <input
                  className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                  type="number"
                  inputMode="numeric"
                  value={String(dt.historyLimit)}
                  onChange={(e) => updateDingtalk({ historyLimit: Number(e.target.value || '0') || 0 })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{ch.textChunkLimit}</FieldLabel>
                <input
                  className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                  type="number"
                  inputMode="numeric"
                  value={String(dt.textChunkLimit)}
                  onChange={(e) => updateDingtalk({ textChunkLimit: Number(e.target.value || '0') || 0 })}
                />
              </div>
            </div>

            <ChannelAgentRoutingBlock
              accountIds={dingtalkRoutingAccountIds(dt)}
              routes={form.channelAgentRoutes.dingtalk}
              defaultAgentId={form.defaultAgentId}
              agentItems={chatAgents?.items ?? []}
              disabled={saving}
              onChange={(acc, aid) => updateChannelAgentRoute('dingtalk', acc, aid)}
              ch={ch}
            />

            <div className="flex flex-col gap-1.5">
              <FieldLabel>{ch.multiAccountJson}</FieldLabel>
              <textarea
                className={cn(inputClassName(), 'min-h-[140px] resize-y font-mono text-xs')}
                spellCheck={false}
                value={dingtalkAccountsDraft}
                onChange={(e) => setDingtalkAccountsDraft(e.target.value)}
                onBlur={onDingtalkAccountsBlur}
                placeholder='{ "default": { "clientId": "...", "clientSecret": "...", "enabled": true } }'
              />
              {dingtalkAccountsError ? (
                <p className="text-xs text-red-600 dark:text-red-400">{dingtalkAccountsError}</p>
              ) : (
                <FieldHint>{ch.multiAccountJsonDesc}</FieldHint>
              )}
            </div>
          </div>

          <div className="mt-8 flex flex-wrap justify-end gap-2 border-t border-edge-subtle pt-4 dark:border-edge-subtle">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {ch.modalCancel}
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
