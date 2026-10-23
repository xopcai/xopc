import { AsyncLocalStorage } from 'node:async_hooks';

import type { SimpleStreamOptions } from '@earendil-works/pi-ai';

import { XopcCloudAccountService } from '../providers/xopc-cloud-account-service.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { getAiUsageEvent, setAiUsageCloudRequest, setAiUsageCloudReceipt, markAiUsageCloudReceiptAttempt } from '../storage/sqlite/ai-usage-repository.js';

const calls = new AsyncLocalStorage<{ id: string; operation?: string }>();
const active = new Map<string, Promise<void>>();

export function withUsageReceiptContext<T>(id: string, action: () => T, operation?: string): T {
  return calls.run({ id, operation }, action);
}

export function currentUsageRequestContext() { return calls.getStore(); }

export function captureCloudUsageResponse(response: { status: number; headers: Headers | Record<string, string> }): void {
  if (response.status < 200 || response.status >= 300) return;
  const id = calls.getStore()?.id;
  const requestId = new Headers(response.headers).get('x-xopc-request-id');
  if (id && requestId && isXopcDatabaseOpen()) {
    try { setAiUsageCloudRequest(id, requestId); } catch { /* Billing telemetry must not fail a model call. */ }
  }
}

/** Preserve existing response hooks while linking the physical Cloud request to its usage row. */
export function withCloudUsageResponse(options?: SimpleStreamOptions): SimpleStreamOptions {
  return { ...options, onResponse: async (response, model) => {
    if (model.provider === 'xopc-cloud') captureCloudUsageResponse(response);
    await options?.onResponse?.(response, model);
  } };
}

/** Bounded, read-only synchronization. Missing authorization or receipt never becomes a zero charge. */
export function reconcileCloudUsageReceipt(id: string): Promise<void> {
  const running = active.get(id);
  if (running) return running;
  if (!isXopcDatabaseOpen() || active.size >= 4) return Promise.resolve();
  const row = getAiUsageEvent(id);
  if (row?.provider !== 'xopc-cloud' || typeof row.cloud_request_id !== 'string') return Promise.resolve();
  const state = row.cloud_billing_json ? JSON.parse(String(row.cloud_billing_json)).state : undefined;
  if (state === 'settled' || state === 'released') return Promise.resolve();
  const requestId = row.cloud_request_id;
  markAiUsageCloudReceiptAttempt(id);
  const service = new XopcCloudAccountService({
    fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(5_000) }),
  });
  const sync = (async () => {
    try {
      const receipt = await service.getReceipt(requestId);
      if (receipt?.requestId === requestId && isXopcDatabaseOpen()) setAiUsageCloudReceipt(id, receipt);
    } catch { /* Retry when the usage page refreshes; retain the last authoritative state. */ }
  })().finally(() => active.delete(id));
  active.set(id, sync);
  return sync;
}
