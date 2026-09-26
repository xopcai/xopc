import { XopcHistory } from '../model/chat';
import { historyRows } from '../common/chatProtocol';
import { XopcSecureStore, utf8 } from './secureStore';

interface XopcCachedHistoryHead { gatewayId: string; conversationId: string; page: XopcHistory; }
interface XopcCachedHistoryPage {
  gatewayId: string;
  conversationId: string;
  transcriptId: string;
  before: string;
  page: XopcHistory;
}
const CACHE_KEY: string = 'chat-history-heads.v1';
const CACHE_LIMIT: number = 48 * 1024;
const PAGE_CACHE_KEY: string = 'chat-history-pages.v1';
const PAGE_CACHE_LIMIT: number = 120 * 1024;
const PAGE_LIMIT: number = 20;

export class XopcChatHistoryCache {
  private store: XopcSecureStore;
  private pending: Promise<void> = Promise.resolve();
  private generation: number = 0;
  revision(): number { return this.generation; }
  constructor(store: XopcSecureStore = new XopcSecureStore()) { this.store = store; }
  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const operation = this.pending.then(job);
    this.pending = operation.then((): void => {}, (_error: Error): void => {});
    return operation;
  }
  private valid(page: XopcHistory, id: string): boolean {
    if (!page?.session || page.session.key !== id || !Array.isArray(page.session.messages)
      || !page.pagination || typeof page.pagination.hasMore !== 'boolean') return false;
    try { historyRows(page); return true; } catch (_) { return false; }
  }
  private async entries(): Promise<XopcCachedHistoryHead[]> {
    const raw = await this.store.read(CACHE_KEY);
    if (!raw || utf8(raw).length > CACHE_LIMIT) return [];
    try {
      const entries = JSON.parse(raw) as XopcCachedHistoryHead[];
      return Array.isArray(entries) ? entries.filter((entry: XopcCachedHistoryHead): boolean => !!entry
        && typeof entry.gatewayId === 'string' && typeof entry.conversationId === 'string' && this.valid(entry.page, entry.conversationId)).slice(-8) : [];
    } catch (_) { return []; }
  }
  private async pageEntries(): Promise<XopcCachedHistoryPage[]> {
    const raw = await this.store.read(PAGE_CACHE_KEY);
    if (!raw || utf8(raw).length > PAGE_CACHE_LIMIT) return [];
    try {
      const entries = JSON.parse(raw) as XopcCachedHistoryPage[];
      return Array.isArray(entries) ? entries.filter((entry: XopcCachedHistoryPage): boolean => !!entry
        && typeof entry.gatewayId === 'string' && typeof entry.conversationId === 'string'
        && typeof entry.transcriptId === 'string' && !!entry.transcriptId && typeof entry.before === 'string' && !!entry.before
        && entry.page?.session?.transcriptId === entry.transcriptId && this.valid(entry.page, entry.conversationId)).slice(-PAGE_LIMIT) : [];
    } catch (_) { return []; }
  }
  read(gatewayId: string, conversationId: string): Promise<XopcHistory | undefined> {
    return this.serialize(async (): Promise<XopcHistory | undefined> => {
      if (!gatewayId || !conversationId) return undefined;
      return (await this.entries()).find((entry: XopcCachedHistoryHead): boolean => entry.gatewayId === gatewayId && entry.conversationId === conversationId)?.page;
    });
  }
  write(gatewayId: string, conversationId: string, page: XopcHistory): Promise<void> {
    // Serialize before queuing so later caller mutations cannot change the pending write.
    const serialized = JSON.stringify(page);
    return this.serialize(async (): Promise<void> => {
      const snapshot = JSON.parse(serialized) as XopcHistory;
      if (!gatewayId || !conversationId || !this.valid(snapshot, conversationId)) return;
      const entries = await this.entries();
      const existing = entries.find((entry: XopcCachedHistoryHead): boolean => entry.gatewayId === gatewayId && entry.conversationId === conversationId);
      if (existing && JSON.stringify(existing.page) === serialized) return;
      const retained = entries.filter((entry: XopcCachedHistoryHead): boolean => entry.gatewayId !== gatewayId || entry.conversationId !== conversationId);
      // Oversized heads invalidate old snapshots instead of silently serving an older transcript.
      if (utf8(serialized).length <= 40 * 1024) retained.push({ gatewayId, conversationId, page: snapshot });
      while (retained.length > 8 || utf8(JSON.stringify(retained)).length > CACHE_LIMIT) retained.shift();
      await this.store.write(CACHE_KEY, JSON.stringify(retained));
    });
  }
  readPage(gatewayId: string, conversationId: string, transcriptId: string, before: string): Promise<XopcHistory | undefined> {
    return this.serialize(async (): Promise<XopcHistory | undefined> => {
      if (!gatewayId || !conversationId || !transcriptId || !before) return undefined;
      return (await this.pageEntries()).find((entry: XopcCachedHistoryPage): boolean => entry.gatewayId === gatewayId
        && entry.conversationId === conversationId && entry.transcriptId === transcriptId && entry.before === before)?.page;
    });
  }
  writePage(gatewayId: string, conversationId: string, transcriptId: string, before: string, page: XopcHistory): Promise<void> {
    const serialized = JSON.stringify(page);
    return this.serialize(async (): Promise<void> => {
      const snapshot = JSON.parse(serialized) as XopcHistory;
      if (!gatewayId || !conversationId || !transcriptId || !before || snapshot.session?.transcriptId !== transcriptId
        || !this.valid(snapshot, conversationId)) return;
      const entries = await this.pageEntries();
      const retained = entries.filter((entry: XopcCachedHistoryPage): boolean => entry.gatewayId !== gatewayId
        || entry.conversationId !== conversationId || entry.transcriptId !== transcriptId || entry.before !== before);
      retained.push({ gatewayId, conversationId, transcriptId, before, page: snapshot });
      while (retained.length > PAGE_LIMIT || utf8(JSON.stringify(retained)).length > PAGE_CACHE_LIMIT) retained.shift();
      await this.store.write(PAGE_CACHE_KEY, JSON.stringify(retained));
    });
  }
  remove(gatewayId: string, conversationId?: string): Promise<void> {
    ++this.generation;
    return this.serialize(async (): Promise<void> => {
      const retained = (await this.entries()).filter((entry: XopcCachedHistoryHead): boolean => entry.gatewayId !== gatewayId
        || (conversationId !== undefined && entry.conversationId !== conversationId));
      const retainedPages = (await this.pageEntries()).filter((entry: XopcCachedHistoryPage): boolean => entry.gatewayId !== gatewayId
        || (conversationId !== undefined && entry.conversationId !== conversationId));
      await this.store.write(CACHE_KEY, JSON.stringify(retained));
      await this.store.write(PAGE_CACHE_KEY, JSON.stringify(retainedPages));
    });
  }
}
export const chatHistoryCache: XopcChatHistoryCache = new XopcChatHistoryCache();
