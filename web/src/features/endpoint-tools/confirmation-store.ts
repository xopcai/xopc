import { useSyncExternalStore } from 'react';

const PREVIEW_LIMIT = 600;

export interface EndpointConfirmationRequest {
  invocationId: string;
  title: string;
  argumentsPreview: string;
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

export function formatEndpointToolArguments(args: Record<string, unknown>): string {
  const json = JSON.stringify(args, null, 2);
  if (json.length <= PREVIEW_LIMIT) return json;
  return `${json.slice(0, PREVIEW_LIMIT)}\n…`;
}

export function requestEndpointConfirmation(input: {
  invocationId: string;
  title: string;
  args: Record<string, unknown>;
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
      argumentsPreview: formatEndpointToolArguments(input.args),
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
