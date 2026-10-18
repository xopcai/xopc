export function browserHttpUrl(value: string): string {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Invalid browser URL');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS address without embedded credentials');
  return url.href;
}
export type BrowserSearchEngine = 'google' | 'bing' | 'duckduckgo';
export function resolveBrowserInput(input: string, engine?: BrowserSearchEngine): string | null {
  const value = input.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return browserHttpUrl(value);
  if (/^(localhost|127(?:\.\d+){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)) return browserHttpUrl(`http://${value}`);
  if (!/\s/.test(value) && /^(?:[\w-]+\.)+[\w-]+(?::\d+)?(?:[/?#]|$)/i.test(value)) return browserHttpUrl(`https://${value}`);
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) throw new Error('Only HTTP and HTTPS addresses are supported');
  if (!engine) return null;
  const search = { google: 'https://www.google.com/search?q=', bing: 'https://www.bing.com/search?q=', duckduckgo: 'https://duckduckgo.com/?q=' };
  return search[engine] + encodeURIComponent(value);
}
export function clipBrowserBounds(bounds: { x: number; y: number; width: number; height: number }, width: number, height: number) {
  if (!bounds || !Object.values(bounds).every(n => typeof n === 'number' && Number.isFinite(n))) throw new Error('Invalid browser bounds');
  const x = Math.max(0, Math.min(width, Math.round(bounds.x)));
  const y = Math.max(0, Math.min(height, Math.round(bounds.y)));
  return { x, y, width: Math.max(0, Math.min(width - x, Math.round(bounds.x + bounds.width) - x)), height: Math.max(0, Math.min(height - y, Math.round(bounds.y + bounds.height) - y)) };
}
