let revision = 0;

export const USER_AVATAR_UPDATED_EVENT = 'xopc-user-avatar-updated';

export function bumpUserAvatarCacheRevision(hasAvatar?: boolean): number {
  revision += 1;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(USER_AVATAR_UPDATED_EVENT, { detail: { hasAvatar } }));
  }
  return revision;
}

export function getUserAvatarCacheRevision(): number {
  return revision;
}
