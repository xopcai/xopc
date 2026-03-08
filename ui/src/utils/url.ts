// URL Utilities

export function getBaseUrl(): string {
  return window.location.origin;
}

export function getCurrentHash(): string {
  return location.hash.slice(1);
}

export function isExplicitSessionUrl(): boolean {
  const hash = getCurrentHash();
  return hash.startsWith('chat/') && 
         hash !== 'chat' && 
         hash !== 'chat/';
}

export function extractSessionKeyFromUrl(): string | null {
  const hash = getCurrentHash();
  const match = hash.match(/^chat\/(.+)$/);
  if (match && match[1] && match[1] !== 'new') {
    return decodeURIComponent(match[1]);
  }
  return null;
}
