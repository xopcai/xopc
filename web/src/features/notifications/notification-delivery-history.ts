const STORAGE_KEY = 'xopc.notification-delivery.v1';
const MAX_IDS = 200;

function readIds(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function wasNotificationDelivered(id: string): boolean {
  return readIds().includes(id);
}

export function markNotificationDelivered(id: string): void {
  try {
    const ids = [id, ...readIds().filter((candidate) => candidate !== id)].slice(0, MAX_IDS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Delivery remains useful when storage is unavailable; only deduplication is lost.
  }
}
