/**
 * Finalizable draft lifecycle helpers (aligned with OpenClaw draft-stream-controls).
 */

import { createDraftStreamLoop, type DraftStreamLoop } from './draft-stream-loop.js';

export type FinalizableDraftStreamState = {
  stopped: boolean;
  final: boolean;
};

type StopAndClearMessageIdParams<T> = {
  stopForClear: () => Promise<void>;
  readMessageId: () => T | undefined;
  clearMessageId: () => void;
};

type ClearFinalizableDraftMessageParams<T> = StopAndClearMessageIdParams<T> & {
  isValidMessageId: (value: unknown) => value is T;
  deleteMessage: (messageId: T) => Promise<void>;
  onDeleteSuccess?: (messageId: T) => void;
  warn?: (message: string) => void;
  warnPrefix: string;
};

type FinalizableDraftLifecycleParams<T> = Omit<
  ClearFinalizableDraftMessageParams<T>,
  'stopForClear'
> & {
  throttleMs: number;
  state: FinalizableDraftStreamState;
  sendOrEditStreamMessage: (text: string) => Promise<boolean>;
};

export function createFinalizableDraftStreamControlsForState(params: {
  throttleMs: number;
  state: FinalizableDraftStreamState;
  sendOrEditStreamMessage: (text: string) => Promise<boolean>;
}) {
  const loop = createDraftStreamLoop({
    throttleMs: params.throttleMs,
    isStopped: () => params.state.stopped,
    sendOrEditStreamMessage: params.sendOrEditStreamMessage,
  });

  const update = (text: string) => {
    if (params.state.stopped || params.state.final) {
      return;
    }
    loop.update(text);
  };

  const stop = async (): Promise<void> => {
    params.state.final = true;
    await loop.flush();
  };

  const stopForClear = async (): Promise<void> => {
    params.state.stopped = true;
    loop.stop();
    await loop.waitForInFlight();
  };

  return {
    loop,
    update,
    stop,
    stopForClear,
  };
}

export async function clearFinalizableDraftMessage<T>(
  params: ClearFinalizableDraftMessageParams<T>,
): Promise<void> {
  await params.stopForClear();
  const messageId = params.readMessageId();
  params.clearMessageId();
  if (!params.isValidMessageId(messageId)) {
    return;
  }
  try {
    await params.deleteMessage(messageId);
    params.onDeleteSuccess?.(messageId);
  } catch (err) {
    params.warn?.(`${params.warnPrefix}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function createFinalizableDraftLifecycle<T>(params: FinalizableDraftLifecycleParams<T>) {
  const controls = createFinalizableDraftStreamControlsForState({
    throttleMs: params.throttleMs,
    state: params.state,
    sendOrEditStreamMessage: params.sendOrEditStreamMessage,
  });

  const clear = async () => {
    await clearFinalizableDraftMessage({
      stopForClear: controls.stopForClear,
      readMessageId: params.readMessageId,
      clearMessageId: params.clearMessageId,
      isValidMessageId: params.isValidMessageId,
      deleteMessage: params.deleteMessage,
      onDeleteSuccess: params.onDeleteSuccess,
      warn: params.warn,
      warnPrefix: params.warnPrefix,
    });
  };

  return {
    ...controls,
    clear,
  };
}
