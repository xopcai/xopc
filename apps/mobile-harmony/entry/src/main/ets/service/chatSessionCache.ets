import { XopcSessionItem, XopcSessionList } from '../model/chat';
import { XopcSecureStore, utf8 } from './secureStore';

interface XopcCachedSessionList {
  gatewayId: string;
  savedAt: number;
  page: XopcSessionList;
}

const SESSION_CACHE_KEY: string = 'chat-session-lists.v1';
const SESSION_CACHE_LIMIT: number = 64 * 1024;
const SESSION_GATEWAY_LIMIT: number = 4;
const SESSION_ITEM_LIMIT: number = 60;

export class XopcChatSessionCache {
  private store: XopcSecureStore;
  private pending: Promise<void> = Promise.resolve();

  constructor(store: XopcSecureStore = new XopcSecureStore()) { this.store = store; }

  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const operation = this.pending.then(job);
    this.pending = operation.then((): void => {}, (_error: Error): void => {});
    return operation;
  }

  private validItem(item: XopcSessionItem): boolean {
    return !!item && typeof item.key === 'string' && !!item.key && typeof item.updatedAt === 'string'
      && typeof item.messageCount === 'number';
  }

  private validPage(page: XopcSessionList): boolean {
    return !!page && Array.isArray(page.items) && page.items.every((item: XopcSessionItem): boolean => this.validItem(item))
      && typeof page.total === 'number' && typeof page.hasMore === 'boolean';
  }

  private async entries(): Promise<XopcCachedSessionList[]> {
    const raw = await this.store.read(SESSION_CACHE_KEY);
    if (!raw || utf8(raw).length > SESSION_CACHE_LIMIT) return [];
    try {
      const entries = JSON.parse(raw) as XopcCachedSessionList[];
      return Array.isArray(entries) ? entries.filter((entry: XopcCachedSessionList): boolean => !!entry
        && typeof entry.gatewayId === 'string' && !!entry.gatewayId && typeof entry.savedAt === 'number'
        && this.validPage(entry.page)).slice(-SESSION_GATEWAY_LIMIT) : [];
    } catch (_) { return []; }
  }

  read(gatewayId: string): Promise<XopcSessionList | undefined> {
    return this.serialize(async (): Promise<XopcSessionList | undefined> => {
      if (!gatewayId) return undefined;
      return (await this.entries()).find((entry: XopcCachedSessionList): boolean => entry.gatewayId === gatewayId)?.page;
    });
  }

  write(gatewayId: string, page: XopcSessionList): Promise<void> {
    const snapshot: XopcSessionList = {
      items: page.items.slice(0, SESSION_ITEM_LIMIT), total: page.total,
      hasMore: page.hasMore || page.items.length > SESSION_ITEM_LIMIT
    };
    const serialized = JSON.stringify(snapshot);
    return this.serialize(async (): Promise<void> => {
      if (!gatewayId || !this.validPage(snapshot) || utf8(serialized).length > SESSION_CACHE_LIMIT) return;
      const retained = (await this.entries()).filter((entry: XopcCachedSessionList): boolean => entry.gatewayId !== gatewayId);
      retained.push({ gatewayId, savedAt: Date.now(), page: JSON.parse(serialized) as XopcSessionList });
      while (retained.length > SESSION_GATEWAY_LIMIT || utf8(JSON.stringify(retained)).length > SESSION_CACHE_LIMIT) retained.shift();
      await this.store.write(SESSION_CACHE_KEY, JSON.stringify(retained));
    });
  }

  remove(gatewayId: string): Promise<void> {
    return this.serialize(async (): Promise<void> => {
      if (!gatewayId) return;
      const retained = (await this.entries()).filter((entry: XopcCachedSessionList): boolean => entry.gatewayId !== gatewayId);
      await this.store.write(SESSION_CACHE_KEY, JSON.stringify(retained));
    });
  }
}

export const chatSessionCache: XopcChatSessionCache = new XopcChatSessionCache();
