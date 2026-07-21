export const LOCAL_USER_ID = 'local-owner';

export interface UserContextOwner {
  userId: string;
}

export function resolveLocalUserContextOwner(): UserContextOwner {
  return { userId: LOCAL_USER_ID };
}
