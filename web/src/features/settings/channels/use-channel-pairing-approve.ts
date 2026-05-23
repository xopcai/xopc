import { useCallback, type Dispatch, type SetStateAction } from 'react';

import {
  approveChannelPairingBySender,
  approveChannelPairingRequest,
  type PairingChannelId,
} from '@/features/settings/channels-config-api';

export type PairingFeedback = { kind: 'ok' | 'err'; text: string } | null;

export function useChannelPairingApprove(params: {
  channel: PairingChannelId;
  accountId: string;
  messages: { pairingApproved: string; pairingInvalid: string };
  mutate: () => Promise<unknown>;
  setCodeBySender: Dispatch<SetStateAction<Record<string, string>>>;
  setBusySender: Dispatch<SetStateAction<string | null>>;
  setFeedback: Dispatch<SetStateAction<PairingFeedback>>;
}) {
  const { channel, accountId, messages, mutate, setCodeBySender, setBusySender, setFeedback } = params;

  const finishApprove = useCallback(
    async (senderId: string, run: () => Promise<{ senderId: string }>) => {
      setBusySender(senderId);
      setFeedback(null);
      try {
        const result = await run();
        setCodeBySender((prev) => {
          const next = { ...prev };
          delete next[senderId];
          return next;
        });
        setFeedback({
          kind: 'ok',
          text: messages.pairingApproved.replace('{{id}}', result.senderId),
        });
        await mutate();
      } catch (e) {
        const msg = e instanceof Error ? e.message : messages.pairingInvalid;
        setFeedback({ kind: 'err', text: msg.includes('PAIRING') ? messages.pairingInvalid : msg });
      } finally {
        setBusySender(null);
      }
    },
    [messages.pairingApproved, messages.pairingInvalid, mutate, setBusySender, setCodeBySender, setFeedback],
  );

  const approveByCode = useCallback(
    (senderId: string, code: string) => {
      const trimmed = code.trim().toUpperCase();
      if (!trimmed) return;
      void finishApprove(senderId, () =>
        approveChannelPairingRequest({ channel, accountId, code: trimmed }),
      );
    },
    [accountId, channel, finishApprove],
  );

  const quickApprove = useCallback(
    (senderId: string) => {
      void finishApprove(senderId, () =>
        approveChannelPairingBySender({ channel, accountId, senderId }),
      );
    },
    [accountId, channel, finishApprove],
  );

  return { approveByCode, quickApprove };
}
