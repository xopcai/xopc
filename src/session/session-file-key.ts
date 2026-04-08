/**
 * Map session JSON filename stem back to session key.
 * Matches {@link SessionStore} private `fileNameToKey` (colons → underscores on disk).
 */
export function fileStemToSessionKey(fileStem: string): string {
  return fileStem.replace(/_/g, ':');
}
