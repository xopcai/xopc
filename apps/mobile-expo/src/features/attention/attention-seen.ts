import { KEYS, storage } from '../../storage/mmkv';

export type AttentionStamp = { id: string; updatedAt: number };
export type AttentionSeenMap = Record<string, number>;

function storageKey(gatewayId: string): string {
  return `${KEYS.chatAttentionSeenPrefix}${encodeURIComponent(gatewayId)}`;
}

export function readAttentionSeen(gatewayId: string | null | undefined): AttentionSeenMap {
  if (!gatewayId) return {};
  const raw = storage.getString(storageKey(gatewayId));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]),
    ));
  } catch {
    return {};
  }
}

export function markAttentionSeen(
  gatewayId: string | null | undefined,
  items: AttentionStamp[],
): AttentionSeenMap {
  if (!gatewayId) return {};
  const next = Object.fromEntries(
    items.slice(0, 100).map((item) => [item.id, item.updatedAt]),
  );
  storage.set(storageKey(gatewayId), JSON.stringify(next));
  return next;
}

export function unseenAttentionItems<T extends AttentionStamp>(items: T[], seen: AttentionSeenMap): T[] {
  return items.filter((item) => (seen[item.id] ?? -1) < item.updatedAt);
}
