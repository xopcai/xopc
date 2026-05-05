import * as Dialog from '@radix-ui/react-dialog';
import { Check, Copy, Eye, EyeOff, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ChatAgentsPayload } from '@/features/chat/chat-agents-api';
import { feishuRoutingAccountIds } from '@/features/settings/channel-bindings-merge';
import type { ChannelsSettingsState, DmPolicy, GroupPolicy } from '@/features/settings/channels-config-api';
import { cn } from '@/lib/cn';
import type { ChannelsSettingsMessages } from '@/i18n/messages';

import { ChannelAgentRoutingBlock } from './channel-agent-routing-block';
import { FieldHint, FieldLabel } from './field-primitives';
import { channelsInputClassName, isFeishuConfigured, joinAllowFrom, parseIdList } from './utils';

export function FeishuChannelSettingsDialog({
  open,
  onOpenChange,
  ch,
  form,
  baseline,
  showFeishuSecret,
  setShowFeishuSecret,
  showFeishuWebhookSecrets,
  setShowFeishuWebhookSecrets,
  feishuCopied,
  feishuWebhookCopied,
  copyFeishuSecret,
  copyFeishuWebhookConfig,
  updateFeishu,
  updateChannelAgentRoute,
  feishuAccountsDraft,
  setFeishuAccountsDraft,
  feishuAccountsError,
  onFeishuAccountsBlur,
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
  showFeishuSecret: boolean;
  setShowFeishuSecret: (v: boolean | ((b: boolean) => boolean)) => void;
  showFeishuWebhookSecrets: boolean;
  setShowFeishuWebhookSecrets: (v: boolean | ((b: boolean) => boolean)) => void;
  feishuCopied: boolean;
  feishuWebhookCopied: boolean;
  copyFeishuSecret: () => Promise<void>;
  copyFeishuWebhookConfig: () => Promise<void>;
  updateFeishu: (patch: Partial<ChannelsSettingsState['feishu']>) => void;
  updateChannelAgentRoute: (channel: 'feishu', accountId: string, agentId: string) => void;
  feishuAccountsDraft: string;
  setFeishuAccountsDraft: (s: string) => void;
  feishuAccountsError: string;
  onFeishuAccountsBlur: () => void;
  dmOpts: { value: DmPolicy; label: string }[];
  groupOpts: { value: GroupPolicy; label: string }[];
  chatAgents: ChatAgentsPayload | undefined;
  saving: boolean;
  dirty: boolean;
  save: () => Promise<boolean>;
  onOpenQrSetup: () => void;
}) {
  const inputClassName = channelsInputClassName;
  const fs = form.feishu;
  const feishuBaselineSecret = baseline?.feishu?.appSecret ?? '';
  const feishuSecretDisplayLocked =
    !showFeishuSecret &&
    Boolean(String(feishuBaselineSecret).trim()) &&
    fs.appSecret === feishuBaselineSecret;
  const feishuConfigured = isFeishuConfigured(fs);

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
              <Dialog.Title className="text-lg font-semibold tracking-tight text-fg">{ch.feishuTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">{ch.feishuSubtitle}</Dialog.Description>
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
              checked={fs.enabled}
              onChange={(e) => updateFeishu({ enabled: e.target.checked })}
            />
            <span>{ch.enableFeishuAria}</span>
          </label>

          {!feishuConfigured ? (
            <div className="mt-6 rounded-xl border border-dashed border-accent/40 bg-accent/5 px-4 py-3 dark:bg-accent/10">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-fg">{ch.feishuQrSetupTitle}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">{ch.feishuQrSetupDesc}</p>
                </div>
                <Button type="button" variant="primary" className="shrink-0" onClick={onOpenQrSetup}>
                  {ch.feishuQrSetupButton}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="mt-6 space-y-4">
            <div className="flex flex-col gap-1.5">
              <FieldLabel>
                {ch.feishuAppId}
                <span className="text-red-600 dark:text-red-400"> *</span>
              </FieldLabel>
              <input
                className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                value={fs.appId}
                onChange={(e) => updateFeishu({ appId: e.target.value })}
                placeholder="cli_xxx"
              />
              <FieldHint>{ch.feishuAppIdDesc}</FieldHint>
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel>
                {ch.feishuAppSecret}
                <span className="text-red-600 dark:text-red-400"> *</span>
              </FieldLabel>
              <div className="flex flex-wrap gap-2">
                <input
                  className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                  type={showFeishuSecret ? 'text' : 'password'}
                  autoComplete="off"
                  readOnly={feishuSecretDisplayLocked}
                  value={
                    feishuSecretDisplayLocked
                      ? '*'.repeat(Math.max(1, fs.appSecret.length))
                      : fs.appSecret
                  }
                  onChange={(e) => {
                    if (feishuSecretDisplayLocked) return;
                    updateFeishu({ appSecret: e.target.value });
                  }}
                  placeholder="••••••••"
                />
                {fs.appSecret ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={() => void copyFeishuSecret()}
                  >
                    {feishuCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {feishuCopied ? ch.copied : ch.copy}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  className="px-2 py-1 text-xs"
                  onClick={() => setShowFeishuSecret((s) => !s)}
                >
                  {showFeishuSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  {showFeishuSecret ? ch.hide : ch.show}
                </Button>
              </div>
              <FieldHint>{ch.feishuAppSecretDesc}</FieldHint>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{ch.feishuDomain}</FieldLabel>
                <select
                  className={inputClassName()}
                  value={String(fs.domain || 'feishu')}
                  onChange={(e) => updateFeishu({ domain: e.target.value })}
                >
                  <option value="feishu">feishu</option>
                  <option value="lark">lark</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{ch.connectionMode}</FieldLabel>
                <select
                  className={inputClassName()}
                  value={fs.connectionMode}
                  onChange={(e) =>
                    updateFeishu({ connectionMode: e.target.value as ChannelsSettingsState['feishu']['connectionMode'] })
                  }
                >
                  <option value="websocket">websocket</option>
                  <option value="webhook">webhook</option>
                </select>
                <FieldHint>{ch.connectionModeDesc}</FieldHint>
              </div>
            </div>

            {fs.connectionMode === 'webhook' ? (
              <div className="rounded-xl border border-edge-subtle bg-surface px-4 py-3 dark:border-edge-subtle">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-fg">{ch.webhookTitle}</div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="px-2 py-1 text-xs"
                      onClick={() => setShowFeishuWebhookSecrets((s) => !s)}
                    >
                      {showFeishuWebhookSecrets ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      {showFeishuWebhookSecrets ? ch.hide : ch.show}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="px-2 py-1 text-xs"
                      onClick={() => void copyFeishuWebhookConfig()}
                    >
                      {feishuWebhookCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {feishuWebhookCopied ? ch.copied : ch.copy}
                    </Button>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel>{ch.verificationToken}</FieldLabel>
                    <input
                      className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                      type={showFeishuWebhookSecrets ? 'text' : 'password'}
                      autoComplete="off"
                      value={fs.verificationToken ?? ''}
                      onChange={(e) => updateFeishu({ verificationToken: e.target.value })}
                    />
                    <FieldHint>{ch.verificationTokenDesc}</FieldHint>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel>{ch.encryptKey}</FieldLabel>
                    <input
                      className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                      type={showFeishuWebhookSecrets ? 'text' : 'password'}
                      autoComplete="off"
                      value={fs.encryptKey ?? ''}
                      onChange={(e) => updateFeishu({ encryptKey: e.target.value })}
                    />
                    <FieldHint>{ch.encryptKeyDesc}</FieldHint>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <FieldLabel>{ch.webhookHost}</FieldLabel>
                    <input
                      className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                      value={fs.webhookHost ?? ''}
                      onChange={(e) => updateFeishu({ webhookHost: e.target.value })}
                      placeholder="127.0.0.1"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel>{ch.webhookPort}</FieldLabel>
                    <input
                      className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                      type="number"
                      inputMode="numeric"
                      value={String(fs.webhookPort ?? '')}
                      onChange={(e) =>
                        updateFeishu({ webhookPort: Number(e.target.value || '0') || 0 })
                      }
                      placeholder="3000"
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-col gap-1.5">
                  <FieldLabel>{ch.webhookPath}</FieldLabel>
                  <input
                    className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                    value={fs.webhookPath ?? ''}
                    onChange={(e) => updateFeishu({ webhookPath: e.target.value })}
                    placeholder="/feishu/events"
                  />
                  <FieldHint>{ch.webhookPathDesc}</FieldHint>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{ch.renderMode}</FieldLabel>
                <select
                  className={inputClassName()}
                  value={fs.renderMode}
                  onChange={(e) =>
                    updateFeishu({ renderMode: e.target.value as ChannelsSettingsState['feishu']['renderMode'] })
                  }
                >
                  <option value="auto">auto</option>
                  <option value="raw">raw</option>
                  <option value="card">card</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{ch.reactionNotifications}</FieldLabel>
                <select
                  className={inputClassName()}
                  value={fs.reactionNotifications}
                  onChange={(e) =>
                    updateFeishu({
                      reactionNotifications: e.target
                        .value as ChannelsSettingsState['feishu']['reactionNotifications'],
                    })
                  }
                >
                  <option value="off">off</option>
                  <option value="own">own</option>
                  <option value="all">all</option>
                </select>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={fs.streaming}
                onChange={(e) => updateFeishu({ streaming: e.target.checked })}
              />
              {ch.enableStreaming}
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{ch.dmPolicy}</FieldLabel>
                <select
                  className={inputClassName()}
                  value={fs.dmPolicy}
                  onChange={(e) =>
                    updateFeishu({ dmPolicy: e.target.value as ChannelsSettingsState['feishu']['dmPolicy'] })
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
                  value={fs.groupPolicy}
                  onChange={(e) =>
                    updateFeishu({ groupPolicy: e.target.value as ChannelsSettingsState['feishu']['groupPolicy'] })
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
                checked={fs.requireMention}
                onChange={(e) => updateFeishu({ requireMention: e.target.checked })}
              />
              {ch.requireMention}
            </label>

            <div className="flex flex-col gap-1.5">
              <FieldLabel>{ch.allowFromDm}</FieldLabel>
              <textarea
                className={cn(inputClassName(), 'min-h-[2.75rem] resize-y font-mono text-xs')}
                rows={2}
                placeholder="ou_xxx, on_xxx"
                value={joinAllowFrom(fs.allowFrom)}
                onChange={(e) => updateFeishu({ allowFrom: parseIdList(e.target.value) })}
              />
              <FieldHint>{ch.allowFromDmDesc}</FieldHint>
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel>{ch.allowFromGroups}</FieldLabel>
              <textarea
                className={cn(inputClassName(), 'min-h-[2.75rem] resize-y font-mono text-xs')}
                rows={2}
                placeholder="oc_xxx, oc_yyy"
                value={joinAllowFrom(fs.groupAllowFrom)}
                onChange={(e) => updateFeishu({ groupAllowFrom: parseIdList(e.target.value) })}
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
                  value={String(fs.historyLimit)}
                  onChange={(e) => updateFeishu({ historyLimit: Number(e.target.value || '0') || 0 })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{ch.textChunkLimit}</FieldLabel>
                <input
                  className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                  type="number"
                  inputMode="numeric"
                  value={String(fs.textChunkLimit)}
                  onChange={(e) => updateFeishu({ textChunkLimit: Number(e.target.value || '0') || 0 })}
                />
              </div>
            </div>

            <div className="rounded-xl border border-edge-subtle bg-surface px-4 py-3 dark:border-edge-subtle">
              <div className="text-sm font-medium text-fg">{ch.feishuToolsTitle}</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ['doc', ch.feishuToolDoc],
                    ['wiki', ch.feishuToolWiki],
                    ['drive', ch.feishuToolDrive],
                    ['perm', ch.feishuToolPerm],
                    ['bitable', ch.feishuToolBitable],
                    ['scopes', ch.feishuToolScopes],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                    <input
                      type="checkbox"
                      className="ui-checkbox"
                      checked={Boolean(fs.tools?.[key])}
                      onChange={(e) =>
                        updateFeishu({
                          tools: { ...fs.tools, [key]: e.target.checked },
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div className="mt-2">
                <FieldHint>{ch.feishuToolsDesc}</FieldHint>
              </div>
            </div>

            <div className="rounded-xl border border-edge-subtle bg-surface px-4 py-3 dark:border-edge-subtle">
              <div className="text-sm font-medium text-fg">{ch.feishuActionsTitle}</div>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  checked={Boolean(fs.actions?.reactions)}
                  onChange={(e) =>
                    updateFeishu({
                      actions: { ...fs.actions, reactions: e.target.checked },
                    })
                  }
                />
                {ch.feishuActionReactions}
              </label>
            </div>

            <ChannelAgentRoutingBlock
              accountIds={feishuRoutingAccountIds(fs)}
              routes={form.channelAgentRoutes.feishu}
              defaultAgentId={form.defaultAgentId}
              agentItems={chatAgents?.items ?? []}
              disabled={saving}
              onChange={(acc, aid) => updateChannelAgentRoute('feishu', acc, aid)}
              ch={ch}
            />

            <div className="flex flex-col gap-1.5">
              <FieldLabel>{ch.multiAccountJson}</FieldLabel>
              <textarea
                className={cn(inputClassName(), 'min-h-[140px] resize-y font-mono text-xs')}
                spellCheck={false}
                value={feishuAccountsDraft}
                onChange={(e) => setFeishuAccountsDraft(e.target.value)}
                onBlur={onFeishuAccountsBlur}
                placeholder='{ "default": { "appId": "...", "appSecret": "...", "enabled": true } }'
              />
              {feishuAccountsError ? (
                <p className="text-xs text-red-600 dark:text-red-400">{feishuAccountsError}</p>
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
