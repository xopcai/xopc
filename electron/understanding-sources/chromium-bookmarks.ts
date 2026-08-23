import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import type { UnderstandingSourceItem } from '../../src/user-context/sources/types.js';

const SOURCE_ID = 'chromium-bookmarks';
const MAX_ITEMS = 300;
const MAX_AGE_MS = 90 * 86_400_000;
const CHROMIUM_EPOCH_OFFSET_MS = 11_644_473_600_000;
const SENSITIVE_TOPIC = /(?:bank|banking|wallet|crypto|patient|hospital|medical|therapy|adult|porn|博彩|银行|钱包|医疗|医院|心理|成人)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g;

type BookmarkNode = {
  type?: string;
  name?: string;
  url?: string;
  date_added?: string;
  children?: BookmarkNode[];
};

type BrowserRoot = { name: string; path: string };

export interface ChromiumBookmarkCollectionOptions {
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  nowMs?: number;
}

function browserRoots(home: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): BrowserRoot[] {
  if (platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support');
    return [
      { name: 'Chrome', path: join(support, 'Google', 'Chrome') },
      { name: 'Edge', path: join(support, 'Microsoft Edge') },
      { name: 'Brave', path: join(support, 'BraveSoftware', 'Brave-Browser') },
      { name: 'Chromium', path: join(support, 'Chromium') },
    ];
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    return [
      { name: 'Chrome', path: join(local, 'Google', 'Chrome', 'User Data') },
      { name: 'Edge', path: join(local, 'Microsoft', 'Edge', 'User Data') },
      { name: 'Brave', path: join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
      { name: 'Chromium', path: join(local, 'Chromium', 'User Data') },
    ];
  }
  const config = env.XDG_CONFIG_HOME ?? join(home, '.config');
  return [
    { name: 'Chrome', path: join(config, 'google-chrome') },
    { name: 'Edge', path: join(config, 'microsoft-edge') },
    { name: 'Brave', path: join(config, 'BraveSoftware', 'Brave-Browser') },
    { name: 'Chromium', path: join(config, 'chromium') },
  ];
}

function chromiumTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const microseconds = Number(value);
  if (!Number.isFinite(microseconds) || microseconds <= 0) return undefined;
  const timestamp = microseconds / 1_000 - CHROMIUM_EPOCH_OFFSET_MS;
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLocaleLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1'
    || (host.includes(':') && (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')))
    || host.endsWith('.local') || !host.includes('.')) return true;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31);
}

function safeTitle(value: string | undefined): string {
  return (value ?? '').replace(EMAIL, '<email>').replace(LONG_TOKEN, '<redacted>').trim().slice(0, 300);
}

export function sanitizeBookmarkUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname || isPrivateHost(url.hostname) || SENSITIVE_TOPIC.test(url.hostname)) return null;
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
  } catch {
    return null;
  }
}

function bookmarkId(browser: string, profile: string, url: string, title: string): string {
  return createHash('sha256').update(`${browser}\0${profile}\0${url}\0${title}`).digest('hex').slice(0, 24);
}

function collectNodes(
  node: BookmarkNode,
  context: { browser: string; profile: string; folders: string[]; nowMs: number; depth: number },
  output: UnderstandingSourceItem[],
): void {
  if (output.length >= MAX_ITEMS) return;
  if (node.type === 'url' && typeof node.url === 'string') {
    const title = safeTitle(node.name);
    const resourceUri = sanitizeBookmarkUrl(node.url);
    const occurredAt = chromiumTime(node.date_added);
    if (!title || !resourceUri || !occurredAt || context.nowMs - occurredAt > MAX_AGE_MS
      || SENSITIVE_TOPIC.test(title) || context.folders.some((folder) => SENSITIVE_TOPIC.test(folder))) return;
    const id = bookmarkId(context.browser, context.profile, resourceUri, title);
    output.push({
      id,
      sourceId: SOURCE_ID,
      type: 'bookmark',
      title,
      group: [context.browser, context.profile, ...context.folders].join('/').slice(0, 200),
      resourceUri,
      occurredAt,
      ownerAttribution: 'user',
      sensitivity: 'personal',
      evidenceRef: `${SOURCE_ID}://${id}`,
    });
    return;
  }
  if (!Array.isArray(node.children) || context.depth >= 20) return;
  const folder = safeTitle(node.name);
  if (folder && SENSITIVE_TOPIC.test(folder)) return;
  const folders = folder ? [...context.folders, folder] : context.folders;
  for (const child of node.children) collectNodes(child, { ...context, folders, depth: context.depth + 1 }, output);
}

export async function collectChromiumBookmarkItems(
  options: ChromiumBookmarkCollectionOptions = {},
): Promise<UnderstandingSourceItem[]> {
  const home = options.homeDirectory ?? homedir();
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const nowMs = options.nowMs ?? Date.now();
  const output: UnderstandingSourceItem[] = [];
  for (const browser of browserRoots(home, platform, environment)) {
    const entries = await readdir(browser.path, { withFileTypes: true }).catch(() => []);
    const profiles = entries.filter((entry) => entry.isDirectory()
      && (entry.name === 'Default' || /^Profile \d+$/.test(entry.name))).slice(0, 20);
    for (const profile of profiles) {
      const raw = await readFile(join(browser.path, profile.name, 'Bookmarks'), 'utf8').catch(() => '');
      if (!raw) continue;
      let roots: Record<string, BookmarkNode> | undefined;
      try { roots = (JSON.parse(raw) as { roots?: Record<string, BookmarkNode> }).roots; } catch { continue; }
      if (!roots) continue;
      for (const [rootName, node] of Object.entries(roots)) {
        collectNodes(node, {
          browser: browser.name,
          profile: profile.name === 'Default' ? 'Default' : basename(profile.name),
          folders: [rootName],
          nowMs,
          depth: 0,
        }, output);
      }
    }
  }
  return output.sort((left, right) => (right.occurredAt ?? 0) - (left.occurredAt ?? 0)).slice(0, MAX_ITEMS);
}
