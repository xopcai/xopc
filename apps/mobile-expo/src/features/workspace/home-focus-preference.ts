import { KEYS, storage } from '../../storage/mmkv';

export function readPinnedHomeFocusId(): string | null {
  return storage.getString(KEYS.homePinnedFocusId)?.trim() || null;
}

export function writePinnedHomeFocusId(id: string | null): void {
  if (id) storage.set(KEYS.homePinnedFocusId, id);
  else storage.delete(KEYS.homePinnedFocusId);
}
