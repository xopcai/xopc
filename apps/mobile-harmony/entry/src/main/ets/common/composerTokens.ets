export interface XopcComposerRange { kind: string; start: number; end: number; query: string; }
export interface XopcPaletteItem {
  kind: string; id: string; name: string; description: string; token: string; aliases: string[];
  sourceId?: string; version?: string;
}
export function composerRange(text: string, cursor: number): XopcComposerRange | undefined {
  const end = Math.min(text.length, Math.max(0, cursor)); const before = text.slice(0, end);
  const at = before.match(/@([^\s]*)$/);
  if (at && at.index !== undefined && (at.index === 0 || !/[a-zA-Z0-9_]/.test(text[at.index - 1])) && !at[0].startsWith('@file:')) {
    return { kind: 'mention', start: at.index, end, query: at[1] || '' };
  }
  const slash = before.match(/\/[^\s]*$/);
  if (slash && slash.index !== undefined && !slash[0].startsWith('/skill:')) return { kind: 'slash', start: slash.index, end, query: slash[0].slice(1) };
  return undefined;
}
export function workspaceMention(path: string): string {
  return '@file:' + (/^[a-zA-Z0-9_./\-\p{L}\p{N}]+$/u.test(path) ? path : '"' + path.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"') + ' ';
}
export function paletteRank(item: XopcPaletteItem, query: string): number {
  const needle = query.trim().toLowerCase(); const name = item.name.toLowerCase();
  if (!needle || name === needle) return 0;
  if (item.aliases.some((alias: string): boolean => alias.toLowerCase() === needle)) return 1;
  if (name.startsWith(needle)) return 2;
  if (item.aliases.some((alias: string): boolean => alias.toLowerCase().startsWith(needle))) return 3;
  if (name.includes(needle)) return 4;
  if (item.aliases.some((alias: string): boolean => alias.toLowerCase().includes(needle))) return 5;
  return item.description.toLowerCase().includes(needle) ? 100 : -1;
}
