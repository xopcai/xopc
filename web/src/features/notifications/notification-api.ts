import { ProductNotificationSchema, type ProductNotification } from '@xopcai/gateway-contract';

import { apiFetch } from '@/lib/fetch';
import { isElectron } from '@/lib/electron-env';

const CURSOR_KEY = 'xopc.notifications.cursor.v1';
const CONSUMER_KEY = 'xopc.notifications.consumer.v1';

function storageValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStorageValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Delivery still works when browser storage is unavailable.
  }
}

export function notificationCursor(): string | null {
  return storageValue(CURSOR_KEY);
}

export function saveNotificationCursor(id: string): void {
  setStorageValue(CURSOR_KEY, id);
}

function notificationConsumerId(): string {
  const existing = storageValue(CONSUMER_KEY);
  if (existing) return existing;
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  setStorageValue(CONSUMER_KEY, id);
  return id;
}

export async function fetchNotificationCatchUp(): Promise<ProductNotification[]> {
  const items: ProductNotification[] = [];
  let cursor = notificationCursor();
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({
      since: String(Date.now() - 5 * 60_000),
      limit: '100',
    });
    if (cursor) params.set('after', cursor);
    const response = await apiFetch(`/api/notifications?${params}`);
    if (!response.ok) break;
    const body = await response.json().catch(() => null) as { items?: unknown[] } | null;
    if (!Array.isArray(body?.items)) break;
    const pageItems = body.items.flatMap((item) => {
      const parsed = ProductNotificationSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    items.push(...pageItems);
    cursor = pageItems.at(-1)?.id ?? cursor;
    if (body.items.length < 100 || pageItems.length === 0) break;
  }
  return items;
}

export async function acknowledgeProductNotification(id: string): Promise<void> {
  await apiFetch(`/api/notifications/${encodeURIComponent(id)}/ack`, {
    method: 'POST',
    body: JSON.stringify({
      consumerId: notificationConsumerId(),
      surface: isElectron() ? 'electron' : 'web',
    }),
  }).catch(() => null);
}
