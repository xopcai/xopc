export function getBaseUrl(): string {
  return window.location.origin;
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${getBaseUrl()}${p}`;
}
