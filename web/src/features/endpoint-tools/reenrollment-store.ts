import { useSyncExternalStore } from 'react';

let pending: { resolve(allowed: boolean): void } | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): boolean {
  return Boolean(pending);
}

export function requestEndpointReenrollment(): Promise<boolean> {
  if (pending) return Promise.resolve(false);
  return new Promise((resolve) => {
    pending = { resolve };
    emit();
  });
}

export function settleEndpointReenrollment(allowed: boolean): void {
  const request = pending;
  if (!request) return;
  pending = undefined;
  request.resolve(allowed);
  emit();
}

export function useEndpointReenrollmentRequested(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
