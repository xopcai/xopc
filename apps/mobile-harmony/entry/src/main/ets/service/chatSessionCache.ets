import { XopcSessionItem, XopcSessionList } from '../model/chat';
import { XopcSecureStore, utf8 } from './secureStore';

interface XopcCachedSessionList {
  gatewayId: string;
  deviceId: string;
  savedAt: number;
  page: XopcSessionList;
}

const SESSION_CACHE_KEY: string = 'chat-session-lists.v1';
const SESSION_CACHE_LIMIT: number = 64 * 1024;
const SESSION_GATEWAY_LIMIT: number = 4;
const SESSION_ITEM_LIMIT: number = 60;
const SESSION_CACHE_AGE: number = 72 * 60 * 60 * 1000;

export class XopcChatSessionCache {
  private store: XopcSecureStore;
  private pending: Promise<void> = Promise.resolve();
  private hot: Map<string, XopcCachedSessionList> = new Map<string, XopcCachedSessionList>();

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
        && typeof entry.gatewayId === 'string' && !!entry.gatewayId && typeof entry.deviceId === 'string'
        && typeof entry.savedAt === 'number' && this.fresh(entry.savedAt)
        && this.validPage(entry.page)).slice(-SESSION_GATEWAY_LIMIT) : [];
    } catch (_) { return []; }
  }

  private fresh(savedAt: number): boolean {
    const age = Date.now() - savedAt;
    return age >= 0 && age <= SESSION_CACHE_AGE;
  }

  peek(gatewayId: string, deviceId: string): XopcSessionList | undefined {
    const entry = this.hot.get(gatewayId);
    return entry && entry.deviceId === deviceId && this.fresh(entry.savedAt) ? entry.page : undefined;
  }

  private remember(entry: XopcCachedSessionList): void {
    this.hot.delete(entry.gatewayId);
    this.hot.set(entry.gatewayId, entry);
    if (this.hot.size > SESSION_GATEWAY_LIMIT) this.hot.delete(Array.from(this.hot.keys())[0]);
  }

  read(gatewayId: string, deviceId: string): Promise<XopcSessionList | undefined> {
    const hot = this.peek(gatewayId, deviceId);
    if (hot) return Promise.resolve(hot);
    return this.serialize(async (): Promise<XopcSessionList | undefined> => {
      const entry = (await this.entries()).find((row: XopcCachedSessionList): boolean =>
        row.gatewayId === gatewayId && row.deviceId === deviceId);
      if (entry && !this.peek(gatewayId, deviceId)) this.remember(entry);
      return this.peek(gatewayId, deviceId);
    });
  }

  write(gatewayId: string, deviceId: string, page: XopcSessionList): Promise<void> {
    const snapshot: XopcSessionList = {
      items: page.items.slice(0, SESSION_ITEM_LIMIT), total: page.total,
      hasMore: page.hasMore || page.items.length > SESSION_ITEM_LIMIT
    };
    const serialized = JSON.stringify(snapshot);
    if (!gatewayId || !deviceId || !this.validPage(snapshot) || utf8(serialized).length > SESSION_CACHE_LIMIT) {
      return Promise.resolve();
    }
    const entry: XopcCachedSessionList = { gatewayId, deviceId, savedAt: Date.now(), page: {
      total: snapshot.total, hasMore: snapshot.hasMore,
      items: snapshot.items.map((item: XopcSessionItem): XopcSessionItem => ({
        key: item.key, name: item.name, title: item.title, displayName: item.displayName,
        messageCount: item.messageCount, updatedAt: item.updatedAt, status: item.status,
        projectId: item.projectId, agentId: item.agentId,
        customData: item.customData ? { origin: item.customData.origin } : undefined
      }))
    } };
    this.remember(entry);
    return this.serialize(async (): Promise<void> => {
      const retained = (await this.entries()).filter((row: XopcCachedSessionList): boolean => row.gatewayId !== gatewayId);
      retained.push(entry);
      while (retained.length > SESSION_GATEWAY_LIMIT || utf8(JSON.stringify(retained)).length > SESSION_CACHE_LIMIT) retained.shift();
      await this.store.write(SESSION_CACHE_KEY, JSON.stringify(retained));
    });
  }

  remove(gatewayId: string): Promise<void> {
    this.hot.delete(gatewayId);
    return this.serialize(async (): Promise<void> => {
      if (!gatewayId) return;
      this.hot.delete(gatewayId);
      const retained = (await this.entries()).filter((entry: XopcCachedSessionList): boolean => entry.gatewayId !== gatewayId);
      await this.store.write(SESSION_CACHE_KEY, JSON.stringify(retained));
    });
  }
}

export const chatSessionCache: XopcChatSessionCache = new XopcChatSessionCache();
