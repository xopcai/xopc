import { Check, Loader2, ShieldCheck, UserCheck, X } from 'lucide-react';
import { useId, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import type { ChannelsSettingsMessages } from '@/i18n/messages';

import {
  readChannelAccessView,
  updateChannelAccessConfig,
  type DmPolicyValue,
  type GroupPolicyValue,
} from './channel-access-config';
import {
  approveChannelPairingCode,
  approveChannelPairingSender,
  channelPairingStateSwrKey,
  dismissChannelPairingSender,
  fetchChannelPairingState,
  revokeChannelPairingSender,
  useChannelPairingRealtime,
} from './channel-pairing';
import type { ChannelCatalogEntry } from './use-channel-catalog';

function StringChipListInput({
  label,
  values,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  values: string[];
  placeholder: string;
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const visible = values.filter((v) => v !== '*');

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || visible.includes(trimmed)) {
      setText('');
      return;
    }
    onChange([...visible, trimmed]);
    setText('');
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-fg-muted">{label}</label>
      {visible.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {visible.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-overlay px-2 py-0.5 font-mono text-xs text-fg"
            >
              {item}
              <button
                type="button"
                disabled={disabled}
                className="text-fg-muted hover:text-fg"
                aria-label={`Remove ${item}`}
                onClick={() => onChange(visible.filter((x) => x !== item))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <input
        id={id}
        type="text"
        value={text}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        className="ui-input h-9 w-full rounded-lg border border-edge bg-surface-overlay px-3 text-sm text-fg placeholder:text-fg-subtle"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(text);
          }
        }}
        onBlur={() => {
          if (text.trim()) commit(text);
        }}
      />
    </div>
  );
}

export function ChannelPairingApprovalsList({
  channelId,
  accountId = 'default',
  ch,
  enabled = true,
  showCodeInput = false,
  onPairingChanged,
}: {
  channelId: string;
  accountId?: string;
  ch: ChannelsSettingsMessages;
  enabled?: boolean;
  showCodeInput?: boolean;
  onPairingChanged?: () => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: state, mutate } = useSWR(
    enabled ? channelPairingStateSwrKey(channelId, accountId) : null,
    () => fetchChannelPairingState(channelId, accountId),
    { revalidateOnFocus: true },
  );

  useChannelPairingRealtime((eventChannel) => {
    if (!eventChannel || eventChannel === channelId) {
      void mutate();
      onPairingChanged?.();
    }
  }, enabled);

  const refreshAll = async () => {
    await mutate();
    onPairingChanged?.();
  };

  const handleApproveSender = async (senderId: string) => {
    setBusyKey(`approve:${senderId}`);
    setActionError(null);
    try {
      await approveChannelPairingSender({ channelId, accountId, senderId });
      await refreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDismissSender = async (senderId: string) => {
    setBusyKey(`dismiss:${senderId}`);
    setActionError(null);
    try {
      await dismissChannelPairingSender({ channelId, accountId, senderId });
      await refreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleApproveCode = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusyKey('code');
    setActionError(null);
    try {
      await approveChannelPairingCode({ channelId, accountId, code: trimmed });
      setCode('');
      await refreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleRevoke = async (senderId: string) => {
    setBusyKey(`revoke:${senderId}`);
    setActionError(null);
    try {
      await revokeChannelPairingSender({ channelId, accountId, senderId });
      await refreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const pending = state?.pending ?? [];
  const pairedCredentials = state?.paired?.fromCredentials ?? [];

  if (pending.length === 0 && !showCodeInput && pairedCredentials.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {pending.length > 0 ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-50/80 p-3 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
            <UserCheck className="size-4 shrink-0" aria-hidden />
            <span>{ch.pairingPendingTitle}</span>
          </div>
          <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-300/90">{ch.pairingPendingHint}</p>
          <div className="mt-2.5 space-y-2">
            {pending.map((item) => {
              const approving = busyKey === `approve:${item.senderId}`;
              const dismissing = busyKey === `dismiss:${item.senderId}`;
              return (
                <div
                  key={item.senderId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-overlay px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs font-medium text-fg">{item.senderId}</p>
                    {item.codeLast4 ? (
                      <p className="text-[11px] text-fg-muted">····{item.codeLast4}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant="primary"
                      className="h-8 px-3 text-xs"
                      disabled={busyKey !== null}
                      onClick={() => void handleApproveSender(item.senderId)}
                    >
                      {approving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                      {ch.pairingApprove}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-2.5 text-xs"
                      disabled={busyKey !== null}
                      onClick={() => void handleDismissSender(item.senderId)}
                    >
                      {dismissing ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      {ch.pairingDismiss}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {pairedCredentials.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-fg-muted">{ch.pairedUsersLabel}</p>
          <div className="flex flex-wrap gap-1.5">
            {pairedCredentials.map((senderId) => (
              <span
                key={senderId}
                className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-overlay px-2 py-0.5 font-mono text-xs text-fg"
              >
                <ShieldCheck className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden />
                {senderId}
                <button
                  type="button"
                  disabled={busyKey !== null}
                  aria-label={ch.pairingRevoke.replace('{{id}}', senderId)}
                  className="text-fg-muted hover:text-fg"
                  onClick={() => void handleRevoke(senderId)}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {showCodeInput ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void handleApproveCode();
          }}
        >
          <input
            type="text"
            value={code}
            disabled={busyKey !== null}
            spellCheck={false}
            autoComplete="off"
            placeholder={ch.pairingCodePlaceholder}
            aria-label={ch.pairingCodePlaceholder}
            className="ui-input h-9 min-w-0 flex-1 rounded-lg border border-edge bg-surface-overlay px-3 font-mono text-xs text-fg placeholder:font-sans placeholder:text-fg-subtle"
            onChange={(e) => setCode(e.target.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            className="h-9 shrink-0 px-3 text-xs"
            disabled={busyKey !== null || !code.trim()}
          >
            {busyKey === 'code' ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {ch.pairingCodeApprove}
          </Button>
        </form>
      ) : null}

      {actionError ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">{actionError}</p>
      ) : null}
    </div>
  );
}

export function ChannelAccessPanel({
  entry,
  config,
  disabled,
  ch,
  onChange,
  onPairingChanged,
}: {
  entry: ChannelCatalogEntry;
  config: Record<string, unknown>;
  disabled?: boolean;
  ch: ChannelsSettingsMessages;
  onChange: (next: Record<string, unknown>) => void;
  onPairingChanged?: () => void;
}) {
  const dmSelectId = useId();
  const groupSelectId = useId();
  const view = readChannelAccessView(entry, config);
  const supportsPairing = entry.capabilities?.pairing !== false;

  if (!view.supportsDm && !view.supportsGroup) {
    return null;
  }

  const dmDescription =
    view.dmPolicy === 'pairing'
      ? ch.dmPolicyPairingDesc
      : view.dmPolicy === 'open'
        ? ch.dmPolicyOpenDesc
        : view.dmPolicy === 'allowlist'
          ? ch.dmPolicyAllowlistDesc
          : ch.dmPolicyDisabledDesc;

  return (
    <section className="space-y-4 rounded-xl bg-surface-inset p-4">
      <div>
        <h3 className="text-sm font-semibold text-fg">{ch.accessSectionTitle}</h3>
        <p className="mt-0.5 text-xs text-fg-muted">{ch.accessSectionHint}</p>
      </div>

      {supportsPairing && view.dmPolicy === 'pairing' ? (
        <ChannelPairingApprovalsList
          channelId={entry.id}
          accountId={view.accountId}
          ch={ch}
          showCodeInput
          onPairingChanged={onPairingChanged}
        />
      ) : null}

      {view.supportsDm ? (
        <div className="space-y-2">
          <div className="space-y-1.5">
            <label htmlFor={dmSelectId} className="text-sm font-medium text-fg">{ch.dmAccessLabel}</label>
            <Select
              id={dmSelectId}
              value={view.dmPolicy}
              disabled={disabled}
              className="ui-input h-9 w-full rounded-lg border border-edge bg-surface-overlay px-2.5 text-sm text-fg"
              onChange={(e) => {
                onChange(updateChannelAccessConfig(entry.id, config, { dmPolicy: e.target.value as DmPolicyValue }));
              }}
            >
              {supportsPairing ? <SelectOption value="pairing">{ch.dmPolicyPairingOption}</SelectOption> : null}
              <SelectOption value="open">{ch.dmPolicyOpenOption}</SelectOption>
              <SelectOption value="allowlist">{ch.dmPolicyAllowlistOption}</SelectOption>
              <SelectOption value="disabled">{ch.dmPolicyDisabledOption}</SelectOption>
            </Select>
            <p className="text-xs text-fg-muted">{dmDescription}</p>
          </div>

          {view.dmPolicy === 'allowlist' ? (
            <StringChipListInput
              label={ch.dmAllowlistLabel}
              values={view.allowFrom}
              placeholder={ch.schemaArrayAddPlaceholder}
              disabled={disabled}
              onChange={(allowFrom) => onChange(updateChannelAccessConfig(entry.id, config, { allowFrom }))}
            />
          ) : null}
        </div>
      ) : null}

      {view.supportsGroup ? (
        <div className="space-y-2 border-t border-edge-subtle pt-3">
          <div className="space-y-1.5">
            <label htmlFor={groupSelectId} className="text-sm font-medium text-fg">{ch.groupAccessLabel}</label>
            <Select
              id={groupSelectId}
              value={view.groupPolicy}
              disabled={disabled}
              className="ui-input h-9 w-full rounded-lg border border-edge bg-surface-overlay px-2.5 text-sm text-fg"
              onChange={(e) => {
                onChange(updateChannelAccessConfig(entry.id, config, { groupPolicy: e.target.value as GroupPolicyValue }));
              }}
            >
              <SelectOption value="open">{ch.groupPolicyOpenOption}</SelectOption>
              <SelectOption value="allowlist">{ch.groupPolicyAllowlistOption}</SelectOption>
              <SelectOption value="disabled">{ch.groupPolicyDisabledOption}</SelectOption>
            </Select>
          </div>

          {view.groupPolicy === 'allowlist' ? (
            <StringChipListInput
              label={ch.groupAllowlistLabel}
              values={view.groupAllowFrom}
              placeholder={ch.schemaArrayAddPlaceholder}
              disabled={disabled}
              onChange={(groupAllowFrom) => onChange(updateChannelAccessConfig(entry.id, config, { groupAllowFrom }))}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
