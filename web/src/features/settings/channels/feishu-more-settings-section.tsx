import { Check, ChevronDown, Copy, Eye, EyeOff } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import type { ChatAgentsPayload } from '@/features/chat/agent-selection/chat-agents-api';
import { feishuRoutingAccountIds } from '@/features/settings/channel-bindings-merge';
import type { ChannelsSettingsState, DmPolicy, GroupPolicy } from '@/features/settings/channels-config-api';
import type { ChannelsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import { ChannelAgentRoutingBlock } from './channel-agent-routing-block';
import { ChannelPairingSection } from './channel-pairing-section';
import { FieldHint, FieldLabel, SelectField } from './field-primitives';
import { scrollToChannelPairingSection } from './pairing-scroll';
import { channelsInputClassName, joinAllowFrom, parseIdList } from './utils';

export function FeishuMoreSettingsSection({
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
  language,
  dialogOpen,
  pairingFocus = false,
}: {
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
  updateChannelAgentRoute: (
    channel: 'telegram' | 'weixin' | 'feishu',
    accountId: string,
    agentId: string,
  ) => void;
  feishuAccountsDraft: string;
  setFeishuAccountsDraft: (v: string) => void;
  feishuAccountsError: string;
  onFeishuAccountsBlur: () => void;
  dmOpts: { value: DmPolicy; label: string }[];
  groupOpts: { value: GroupPolicy; label: string }[];
  chatAgents: ChatAgentsPayload | undefined;
  saving: boolean;
  language: string;
  dialogOpen: boolean;
  pairingFocus?: boolean;
}) {
  const inputClassName = channelsInputClassName;
  const fs = form.feishu;
  const feishuAccountIds = feishuRoutingAccountIds(fs);
  const resolvedFeishuAccounts = feishuAccountIds.length > 0 ? feishuAccountIds : ['default'];
  const feishuBaselineSecret = baseline?.feishu?.appSecret ?? '';
  const feishuSecretDisplayLocked =
    !showFeishuSecret &&
    Boolean(String(feishuBaselineSecret).trim()) &&
    fs.appSecret === feishuBaselineSecret;

  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!pairingFocus) return;
    const details = detailsRef.current;
    if (details) details.open = true;
    const timer = window.setTimeout(() => scrollToChannelPairingSection('feishu'), 80);
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
        <p className="text-xs leading-relaxed text-fg-muted">{ch.feishuAdvancedHint}</p>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
          <input
            type="checkbox"
            className="ui-checkbox mt-0.5"
            checked={fs.enabled}
            onChange={(e) => updateFeishu({ enabled: e.target.checked })}
          />
          <span>{ch.enableFeishuAria}</span>
        </label>

        <SelectField
          label={ch.dmPolicy}
          value={fs.dmPolicy}
          onChange={(v) => updateFeishu({ dmPolicy: v })}
          options={dmOpts}
        />
        <ChannelPairingSection
          channel="feishu"
          accountIds={resolvedFeishuAccounts}
          channelConfig={fs}
          active={dialogOpen}
          ch={ch}
          language={language}
        />

        <div className="space-y-4">
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
      </div>
    </details>
  );
}
