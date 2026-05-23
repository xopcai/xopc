import { RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import {
  approveChannelPairingBySender,
  approveChannelPairingRequest,
  fetchChannelPairingState,
  revokeChannelPairingPaired,
  type PairingChannelId,
} from '@/features/settings/channels-config-api';
import type { DmPolicy } from '@/features/settings/channels-settings.types';
import type { ChannelsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import { FieldHint, FieldLabel } from './field-primitives';
import { useChannelPairingSseRefresh } from './use-channel-pairing-sse';
import { channelsInputClassName } from './utils';

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

export function ChannelPairingSection({
  channel,
  accountIds,
  dmPolicy,
  active,
  ch,
  language,
  onPairedChange,
}: {
  channel: PairingChannelId;
  accountIds?: string[];
  dmPolicy: DmPolicy;
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
  const [accountId, setAccountId] = useState(resolvedAccountIds[0] ?? 'default');
  const [codeBySender, setCodeBySender] = useState<Record<string, string>>({});
  const [busySender, setBusySender] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!resolvedAccountIds.includes(accountId)) {
      setAccountId(resolvedAccountIds[0] ?? 'default');
    }
  }, [accountId, resolvedAccountIds]);

  const swrKey = active && dmPolicy === 'pairing' ? pairingSwrKey(channel, accountId) : null;
  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    () => fetchChannelPairingState(channel, accountId),
    { revalidateOnFocus: true },
  );

  const refresh = useCallback(() => {
    void mutate();
  }, [mutate]);

  useChannelPairingSseRefresh(refresh, active && dmPolicy === 'pairing');

  const pairedCred = data?.paired.fromCredentials ?? [];
  useEffect(() => {
    onPairedChange?.(pairedCred.length);
  }, [onPairedChange, pairedCred.length]);

  const approve = useCallback(
    async (senderId: string, code: string) => {
      const trimmed = code.trim().toUpperCase();
      if (!trimmed) return;
      setBusySender(senderId);
      setFeedback(null);
      try {
        const result = await approveChannelPairingRequest({
          channel,
          accountId,
          code: trimmed,
        });
        setCodeBySender((prev) => {
          const next = { ...prev };
          delete next[senderId];
          return next;
        });
        setFeedback({
          kind: 'ok',
          text: ch.pairingApproved.replace('{{id}}', result.senderId),
        });
        await mutate();
      } catch (e) {
        const msg = e instanceof Error ? e.message : ch.pairingInvalid;
        setFeedback({ kind: 'err', text: msg.includes('PAIRING') ? ch.pairingInvalid : msg });
      } finally {
        setBusySender(null);
      }
    },
    [accountId, channel, ch.pairingApproved, ch.pairingInvalid, mutate],
  );

  const quickApprove = useCallback(
    async (senderId: string) => {
      setBusySender(senderId);
      setFeedback(null);
      try {
        const result = await approveChannelPairingBySender({
          channel,
          accountId,
          senderId,
        });
        setCodeBySender((prev) => {
          const next = { ...prev };
          delete next[senderId];
          return next;
        });
        setFeedback({
          kind: 'ok',
          text: ch.pairingApproved.replace('{{id}}', result.senderId),
        });
        await mutate();
      } catch (e) {
        const msg = e instanceof Error ? e.message : ch.pairingInvalid;
        setFeedback({ kind: 'err', text: msg.includes('PAIRING') ? ch.pairingInvalid : msg });
      } finally {
        setBusySender(null);
      }
    },
    [accountId, channel, ch.pairingApproved, ch.pairingInvalid, mutate],
  );

  const revoke = useCallback(
    async (senderId: string) => {
      setRevokingId(senderId);
      setFeedback(null);
      try {
        await revokeChannelPairingPaired({ channel, accountId, senderId });
        setFeedback({
          kind: 'ok',
          text: ch.pairingRevoked.replace('{{id}}', senderId),
        });
        await mutate();
      } catch (e) {
        const msg = e instanceof Error ? e.message : ch.pairingRevokeError;
        setFeedback({ kind: 'err', text: msg });
      } finally {
        setRevokingId(null);
      }
    },
    [accountId, channel, ch.pairingRevoked, ch.pairingRevokeError, mutate],
  );

  if (dmPolicy !== 'pairing') return null;

  const pending = data?.pending ?? [];
  const pairedConfig = data?.paired.fromConfig ?? [];

  return (
    <div className="space-y-3 rounded-xl border border-edge-subtle bg-surface-base/50 p-4 dark:border-edge">
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
        {pending.length === 0 ? (
          <p className="text-xs text-fg-muted">{ch.pairingPendingEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((item) => {
              const code = codeBySender[item.senderId] ?? '';
              const busy = busySender === item.senderId;
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
                      disabled={busy}
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
                        if (e.key === 'Enter') void approve(item.senderId, code);
                      }}
                    />
                    <Button
                      type="button"
                      variant="primary"
                      className="shrink-0 text-xs"
                      disabled={busy || !code.trim()}
                      onClick={() => void approve(item.senderId, code)}
                    >
                      {busy ? ch.pairingApproving : ch.pairingApprove}
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
  dmPolicy: DmPolicy,
): number {
  const swrKey = active && dmPolicy === 'pairing' ? pairingSwrKey(channel, accountId) : null;
  const { data, mutate } = useSWR(swrKey, () => fetchChannelPairingState(channel, accountId), {
    revalidateOnFocus: true,
  });
  useChannelPairingSseRefresh(() => void mutate(), active && dmPolicy === 'pairing');
  return data?.paired.fromCredentials.length ?? 0;
}
