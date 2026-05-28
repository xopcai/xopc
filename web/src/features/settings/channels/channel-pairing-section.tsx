import { RefreshCw, X } from 'lucide-react';
import { useCallback, useMemo, useReducer, useRef, useState, type SetStateAction } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import {
  dismissChannelPairingPending,
  fetchChannelPairingState,
  revokeChannelPairingPaired,
  type PairingChannelId,
} from '@/features/settings/channels-config-api';
import type {
  FeishuConfig,
  TelegramConfig,
  WeixinConfig,
} from '@/features/settings/channels-settings.types';
import type { ChannelsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import { FieldHint, FieldLabel } from './field-primitives';
import { channelUsesPairingPolicy, resolveAccountDmPolicyForConfig } from './pairing-policy';
import { useChannelPairingApprove } from './use-channel-pairing-approve';
import { useChannelPairingSseRefresh } from './use-channel-pairing-sse';
import { channelsInputClassName } from './utils';
import { channelPairingSectionDomId } from './pairing-scroll';

function formatRelativeExpiry(iso: string, locale: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return iso;
  const absMin = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (ms <= 0) {
    return locale.startsWith('zh') ? '已过期' : 'expired';
  }
  if (absMin < 60) {
    return locale.startsWith('zh') ? `${absMin} 分钟后` : `in ${absMin} min`;
  }
  const hours = Math.round(absMin / 60);
  return locale.startsWith('zh') ? `${hours} 小时后` : `in ${hours} h`;
}

function pairingSwrKey(channel: PairingChannelId, accountId: string): string {
  return `channel-pairing-${channel}-${accountId}`;
}

type PairingUiState = {
  codeBySender: Record<string, string>;
  busySender: string | null;
  dismissingId: string | null;
  revokingId: string | null;
  feedback: { kind: 'ok' | 'err'; text: string } | null;
};

const emptyPairingUiState: PairingUiState = {
  codeBySender: {},
  busySender: null,
  dismissingId: null,
  revokingId: null,
  feedback: null,
};

type PairingUiAction =
  | { type: 'setCodeBySender'; updater: (prev: Record<string, string>) => Record<string, string> }
  | { type: 'setBusySender'; value: string | null }
  | { type: 'setDismissingId'; value: string | null }
  | { type: 'setRevokingId'; value: string | null }
  | { type: 'setFeedback'; value: PairingUiState['feedback'] }
  | { type: 'clearSenderCode'; senderId: string };

function pairingUiReducer(state: PairingUiState, action: PairingUiAction): PairingUiState {
  switch (action.type) {
    case 'setCodeBySender':
      return { ...state, codeBySender: action.updater(state.codeBySender) };
    case 'setBusySender':
      return { ...state, busySender: action.value };
    case 'setDismissingId':
      return { ...state, dismissingId: action.value };
    case 'setRevokingId':
      return { ...state, revokingId: action.value };
    case 'setFeedback':
      return { ...state, feedback: action.value };
    case 'clearSenderCode': {
      const next = { ...state.codeBySender };
      delete next[action.senderId];
      return { ...state, codeBySender: next };
    }
  }
}

export function ChannelPairingSection({
  channel,
  accountIds,
  channelConfig,
  active,
  ch,
  language,
  onPairedChange,
}: {
  channel: PairingChannelId;
  accountIds?: string[];
  channelConfig: TelegramConfig | WeixinConfig | FeishuConfig;
  active: boolean;
  ch: ChannelsSettingsMessages;
  language: string;
  onPairedChange?: (pairedCredentialCount: number) => void;
}) {
  const inputClassName = channelsInputClassName;
  const resolvedAccountIds = useMemo(() => {
    const ids = (accountIds ?? ['default']).filter(Boolean);
    return ids.length > 0 ? ids : ['default'];
  }, [accountIds]);
  const sectionUsesPairing = useMemo(
    () => channelUsesPairingPolicy(channel, channelConfig),
    [channel, channelConfig],
  );
  const resolveAccountDmPolicy = useCallback(
    (accountId: string) => resolveAccountDmPolicyForConfig(channel, channelConfig, accountId),
    [channel, channelConfig],
  );

  const [accountId, setAccountId] = useState(resolvedAccountIds[0] ?? 'default');
  const [prevResolvedAccountIds, setPrevResolvedAccountIds] = useState(resolvedAccountIds);
  if (resolvedAccountIds !== prevResolvedAccountIds) {
    setPrevResolvedAccountIds(resolvedAccountIds);
    if (!resolvedAccountIds.includes(accountId)) {
      setAccountId(resolvedAccountIds[0] ?? 'default');
    }
  }

  const [ui, dispatchUi] = useReducer(pairingUiReducer, emptyPairingUiState);
  const { codeBySender, busySender, dismissingId, revokingId, feedback } = ui;

  const accountDmPolicy = resolveAccountDmPolicy(accountId);
  const accountPairingActive = accountDmPolicy === 'pairing';

  const onPairedChangeRef = useRef(onPairedChange);
  onPairedChangeRef.current = onPairedChange;

  const swrKey = active && sectionUsesPairing && accountPairingActive ? pairingSwrKey(channel, accountId) : null;
  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    () => fetchChannelPairingState(channel, accountId),
    {
      revalidateOnFocus: true,
      onSuccess: (result) => {
        onPairedChangeRef.current?.(result.paired.fromCredentials.length);
      },
    },
  );

  const refresh = useCallback(() => {
    void mutate();
  }, [mutate]);

  useChannelPairingSseRefresh(refresh, active && sectionUsesPairing && accountPairingActive);

  const pairedCred = data?.paired.fromCredentials ?? [];

  const setCodeBySender = useCallback(
    (updater: SetStateAction<Record<string, string>>) => {
      dispatchUi({
        type: 'setCodeBySender',
        updater: typeof updater === 'function' ? updater : () => updater,
      });
    },
    [],
  );

  const setBusySender = useCallback((value: SetStateAction<string | null>) => {
    dispatchUi({
      type: 'setBusySender',
      value: typeof value === 'function' ? value(ui.busySender) : value,
    });
  }, [ui.busySender]);

  const setFeedback = useCallback((value: SetStateAction<PairingUiState['feedback']>) => {
    dispatchUi({
      type: 'setFeedback',
      value: typeof value === 'function' ? value(ui.feedback) : value,
    });
  }, [ui.feedback]);

  const { approveByCode, quickApprove } = useChannelPairingApprove({
    channel,
    accountId,
    messages: { pairingApproved: ch.pairingApproved, pairingInvalid: ch.pairingInvalid },
    mutate,
    setCodeBySender,
    setBusySender,
    setFeedback,
  });

  const dismiss = useCallback(
    async (senderId: string) => {
      dispatchUi({ type: 'setDismissingId', value: senderId });
      dispatchUi({ type: 'setFeedback', value: null });
      try {
        await dismissChannelPairingPending({ channel, accountId, senderId });
        dispatchUi({ type: 'clearSenderCode', senderId });
        dispatchUi({
          type: 'setFeedback',
          value: {
            kind: 'ok',
            text: ch.pairingDismissed.replace('{{id}}', senderId),
          },
        });
        await mutate();
      } catch (e) {
        const msg = e instanceof Error ? e.message : ch.pairingDismissError;
        dispatchUi({ type: 'setFeedback', value: { kind: 'err', text: msg } });
      } finally {
        dispatchUi({ type: 'setDismissingId', value: null });
      }
    },
    [accountId, channel, ch.pairingDismissed, ch.pairingDismissError, mutate],
  );

  const revoke = useCallback(
    async (senderId: string) => {
      dispatchUi({ type: 'setRevokingId', value: senderId });
      dispatchUi({ type: 'setFeedback', value: null });
      try {
        await revokeChannelPairingPaired({ channel, accountId, senderId });
        dispatchUi({
          type: 'setFeedback',
          value: {
            kind: 'ok',
            text: ch.pairingRevoked.replace('{{id}}', senderId),
          },
        });
        await mutate();
      } catch (e) {
        const msg = e instanceof Error ? e.message : ch.pairingRevokeError;
        dispatchUi({ type: 'setFeedback', value: { kind: 'err', text: msg } });
      } finally {
        dispatchUi({ type: 'setRevokingId', value: null });
      }
    },
    [accountId, channel, ch.pairingRevoked, ch.pairingRevokeError, mutate],
  );

  if (!sectionUsesPairing) return null;

  if (!accountPairingActive) {
    return (
      <div
        id={channelPairingSectionDomId(channel)}
        className="space-y-2 rounded-xl border border-edge-subtle bg-surface-base/50 p-4 dark:border-edge"
      >
        <h3 className="text-sm font-medium text-fg">{ch.pairingTitle}</h3>
        <p className="text-xs text-fg-muted">{ch.pairingAccountNotPairing.replace('{{account}}', accountId)}</p>
        {resolvedAccountIds.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <FieldLabel>{ch.pairingAccountLabel}</FieldLabel>
            <select
              className={inputClassName()}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {resolvedAccountIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    );
  }

  const pending = data?.pending ?? [];
  const pairedConfig = data?.paired.fromConfig ?? [];

  return (
    <div
      id={channelPairingSectionDomId(channel)}
      className="space-y-3 rounded-xl border border-edge-subtle bg-surface-base/50 p-4 dark:border-edge"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-fg">{ch.pairingTitle}</h3>
          <p className="mt-1 text-xs text-fg-muted">{ch.pairingSubtitle}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="size-8 shrink-0 p-0"
          aria-label={ch.pairingRefresh}
          disabled={isLoading}
          onClick={() => void mutate()}
        >
          <RefreshCw className={cn('size-4 text-fg-muted', isLoading && 'animate-spin')} />
        </Button>
      </div>

      {resolvedAccountIds.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{ch.pairingAccountLabel}</FieldLabel>
          <select
            className={inputClassName()}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {resolvedAccountIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <FieldHint>{ch.pairingSetupHint}</FieldHint>

      {error ? <p className="text-xs text-red-600 dark:text-red-400">{ch.pairingLoadError}</p> : null}
      {feedback ? (
        <p
          className={cn(
            'text-xs',
            feedback.kind === 'ok' ? 'text-success' : 'text-red-600 dark:text-red-400',
          )}
        >
          {feedback.text}
        </p>
      ) : null}

      <div className="space-y-2">
        <FieldLabel>{ch.pairingPendingTitle}</FieldLabel>
        {pending.length > 0 ? <FieldHint>{ch.pairingQuickApproveHint}</FieldHint> : null}
        {pending.length === 0 ? (
          <p className="text-xs text-fg-muted">{ch.pairingPendingEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((item) => {
              const code = codeBySender[item.senderId] ?? '';
              const busy = busySender === item.senderId;
              const dismissing = dismissingId === item.senderId;
              return (
                <li
                  key={item.senderId}
                  className={cn(
                    'rounded-lg border bg-surface-panel p-3 dark:border-edge',
                    item.isStale
                      ? 'border-amber-300/50 dark:border-amber-800/50'
                      : 'border-edge',
                  )}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-xs text-fg">{item.senderId}</span>
                    <span className="text-[11px] text-fg-muted">
                      {item.isStale ? (
                        <span className="text-amber-800 dark:text-amber-200">{ch.pairingStaleItem}</span>
                      ) : null}
                      {item.isStale ? ' · ' : null}
                      {ch.pairingExpiresHint.replace(
                        '{{time}}',
                        formatRelativeExpiry(item.expiresAt, language),
                      )}
                    </span>
                  </div>
                  {item.codeLast4 ? (
                    <p className="mt-1 text-[11px] text-fg-muted">
                      {ch.pairingCodeHint.replace('{{suffix}}', item.codeLast4)}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="shrink-0 text-xs"
                      disabled={busy || dismissing}
                      onClick={() => void quickApprove(item.senderId)}
                    >
                      {busy ? ch.pairingApproving : ch.pairingQuickApprove}
                    </Button>
                    <input
                      className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs uppercase')}
                      value={code}
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={8}
                      placeholder={ch.pairingCodePlaceholder}
                      onChange={(e) =>
                        setCodeBySender((prev) => ({
                          ...prev,
                          [item.senderId]: e.target.value.toUpperCase(),
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') approveByCode(item.senderId, code);
                      }}
                    />
                    <Button
                      type="button"
                      variant="primary"
                      className="shrink-0 text-xs"
                      disabled={busy || dismissing || !code.trim()}
                      onClick={() => approveByCode(item.senderId, code)}
                    >
                      {busy ? ch.pairingApproving : ch.pairingApprove}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="shrink-0 text-xs text-fg-muted hover:text-danger"
                      disabled={busy || dismissing}
                      onClick={() => void dismiss(item.senderId)}
                    >
                      {dismissing ? ch.pairingDismissing : ch.pairingDismiss}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t border-edge-subtle pt-3 dark:border-edge-subtle">
        <FieldLabel>{ch.pairedTitle}</FieldLabel>
        <div className="grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <p className="text-fg-muted">{ch.pairedFromConfig}</p>
            <p className="mt-0.5 font-mono text-fg">
              {pairedConfig.length ? pairedConfig.join(', ') : ch.pairedEmpty}
            </p>
          </div>
          <div>
            <p className="text-fg-muted">{ch.pairedFromCredentials}</p>
            {pairedCred.length === 0 ? (
              <p className="mt-0.5 font-mono text-fg">{ch.pairedEmpty}</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {pairedCred.map((id) => (
                  <li key={id} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-fg">{id}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      className="size-7 shrink-0 p-0 text-fg-muted hover:text-danger"
                      aria-label={ch.pairingRevokeAria.replace('{{id}}', id)}
                      disabled={revokingId === id}
                      onClick={() => void revoke(id)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function useChannelPairingPairedCount(
  channel: PairingChannelId,
  accountId: string,
  active: boolean,
  channelConfig: TelegramConfig | WeixinConfig | FeishuConfig,
): number {
  const usesPairing = channelUsesPairingPolicy(channel, channelConfig);
  const accountPairingActive = resolveAccountDmPolicyForConfig(channel, channelConfig, accountId) === 'pairing';
  const swrKey =
    active && usesPairing && accountPairingActive ? pairingSwrKey(channel, accountId) : null;
  const { data, mutate } = useSWR(swrKey, () => fetchChannelPairingState(channel, accountId), {
    revalidateOnFocus: true,
  });
  useChannelPairingSseRefresh(() => void mutate(), active && usesPairing && accountPairingActive);
  return data?.paired.fromCredentials.length ?? 0;
}
