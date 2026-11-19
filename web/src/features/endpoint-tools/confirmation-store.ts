import { useSyncExternalStore } from 'react';

export interface EndpointConfirmationRequest {
  invocationId: string;
  title: string;
  remember: boolean;
}

type PendingConfirmation = EndpointConfirmationRequest & {
  resolve(allowed: boolean): void;
  timeout: number;
};

let pending: PendingConfirmation[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function snapshot(): EndpointConfirmationRequest | undefined {
  return pending[0];
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestEndpointConfirmation(input: {
  invocationId: string;
  title: string;
  remember: boolean;
  deadlineAt: number;
}): Promise<boolean> {
  if (input.deadlineAt <= Date.now()) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timeout = window.setTimeout(
      () => settleEndpointConfirmation(input.invocationId, false),
      input.deadlineAt - Date.now(),
    );
    pending.push({
      invocationId: input.invocationId,
      title: input.title,
      remember: input.remember,
      resolve,
      timeout,
    });
    emit();
  });
}

export function settleEndpointConfirmation(invocationId: string, allowed: boolean): void {
  const index = pending.findIndex((item) => item.invocationId === invocationId);
  if (index < 0) return;
  const [request] = pending.splice(index, 1);
  window.clearTimeout(request.timeout);
  request.resolve(allowed);
  emit();
}

export function cancelAllEndpointConfirmations(): void {
  const requests = pending;
  pending = [];
  for (const request of requests) {
    window.clearTimeout(request.timeout);
    request.resolve(false);
  }
  emit();
}

export function useEndpointConfirmation(): EndpointConfirmationRequest | undefined {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
