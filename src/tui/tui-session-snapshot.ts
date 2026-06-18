import type { HistoryMessage } from './tui-backend.js';
import { flattenMessageContent } from '../session/client-history.js';

export type TuiSessionSnapshotEntryType =
  | 'message'
  | 'compaction'
  | 'context'
  | 'bash'
  | 'custom'
  | 'branch';

export interface TuiSessionSnapshotEntry {
  id: string;
  type: TuiSessionSnapshotEntryType;
  parentId: string | null;
  customType?: string;
  data?: unknown;
  display?: boolean;
  userLabel?: string;
  labelTimestamp?: string;
  role?: 'user' | 'assistant' | 'system';
  message?: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    usage?: {
      input: number;
      output: number;
      cost: { total: number };
    };
  };
  content: string;
  timestamp?: number;
  raw?: HistoryMessage | Record<string, unknown>;
}

export interface TuiSessionSnapshotHeader {
  type: 'session';
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

export interface TuiSessionSnapshotTreeNode {
  entry: TuiSessionSnapshotEntry;
  children: TuiSessionSnapshotTreeNode[];
  label?: string;
  labelTimestamp?: string;
}

export interface TuiReadonlySessionManager {
  getEntries(): TuiSessionSnapshotEntry[];
  getBranch(): TuiSessionSnapshotEntry[];
  getLeafEntry(): TuiSessionSnapshotEntry | undefined;
  getLeafId(): string | null;
  getEntry(entryId: string): TuiSessionSnapshotEntry | undefined;
  getLabel(entryId: string): string | undefined;
  getHeader(): TuiSessionSnapshotHeader | null;
  getTree(): TuiSessionSnapshotTreeNode[];
  getSessionId(): string;
  getSessionFile(): string | undefined;
  getSessionDir(): string | undefined;
  getSessionName(): string | undefined;
  getCwd(): string;
}

export class TuiSessionSnapshot {
  private entries: TuiSessionSnapshotEntry[] = [];
  private nextId = 1;

  constructor(
    private readonly getSessionKey: () => string,
    private readonly getCwdValue: () => string,
    private readonly getSessionNameValue: () => string | undefined,
    private readonly getSessionFileValue: () => string | undefined = () => undefined,
    private readonly getSessionDirValue: () => string | undefined = () => undefined,
  ) {}

  replaceFromHistory(messages: HistoryMessage[]): void {
    this.nextId = 1;
    let parentId: string | null = null;
    this.entries = messages.map((message) => {
      const entry = this.entryFromHistory(message, parentId);
      parentId = entry.id;
      return entry;
    });
  }

  clear(): void {
    this.entries = [];
    this.nextId = 1;
  }

  appendMessage(role: 'user' | 'assistant' | 'system', content: string): void {
    this.entries.push(this.createEntry({
      type: 'message',
      role,
      content,
      message: {
        role,
        content,
        usage: {
          input: 0,
          output: 0,
          cost: { total: 0 },
        },
      },
      timestamp: Date.now(),
    }));
  }

  setLabel(entryId: string, label: string | undefined): void {
    const entry = this.entries.find((candidate) => candidate.id === entryId);
    if (!entry) return;
    const trimmed = label?.trim();
    if (trimmed) {
      entry.userLabel = trimmed;
      entry.labelTimestamp = new Date().toISOString();
    } else {
      delete entry.userLabel;
      delete entry.labelTimestamp;
    }
  }

  appendCustomEntry(customType: string, data?: unknown): void {
    this.entries.push(this.createEntry({
      type: 'custom',
      customType,
      data,
      display: undefined,
      content: '',
      timestamp: Date.now(),
      raw: {
        type: 'custom',
        customType,
        data,
      },
    }));
  }

  appendCustomMessage(message: {
    customType: string;
    content?: string | unknown[];
    display?: boolean;
    details?: unknown;
  }): void {
    this.entries.push(this.createEntry({
      type: 'custom',
      customType: message.customType,
      data: message.details,
      display: message.display ?? true,
      content: typeof message.content === 'string'
        ? message.content
        : Array.isArray(message.content)
          ? flattenMessageContent(message.content)
          : '',
      timestamp: Date.now(),
      raw: {
        role: 'custom',
        customType: message.customType,
        content: message.content,
        display: message.display ?? true,
        details: message.details,
      },
    }));
  }

  manager(): TuiReadonlySessionManager {
    return {
      getEntries: () => [...this.entries],
      getBranch: () => [...this.entries],
      getLeafEntry: () => this.entries[this.entries.length - 1],
      getLeafId: () => this.entries[this.entries.length - 1]?.id ?? null,
      getEntry: (entryId) => this.entries.find((entry) => entry.id === entryId),
      getLabel: (entryId) => this.entries.find((entry) => entry.id === entryId)?.userLabel,
      getHeader: () => this.createHeader(),
      getTree: () => this.createTree(),
      getSessionId: () => this.getSessionKey(),
      getSessionFile: () => this.getSessionFileValue(),
      getSessionDir: () => this.getSessionDirValue(),
      getSessionName: () => this.getSessionNameValue(),
      getCwd: () => this.getCwdValue(),
    };
  }

  private entryFromHistory(
    message: HistoryMessage,
    parentId: string | null,
  ): TuiSessionSnapshotEntry {
    const type = message.kind ?? 'message';
    const role = message.role;
    const base = {
      id: message.id,
      parentId,
      type,
      customType: message.custom?.customType,
      data: message.custom?.details,
      display: message.custom?.display,
      role,
      content: message.content,
      timestamp: message.timestamp,
      raw: message,
    };
    if (type === 'message') {
      return this.createEntry({
        ...base,
        message: {
          role,
          content: message.content,
          usage: {
            input: 0,
            output: 0,
            cost: { total: 0 },
          },
        },
      });
    }
    return this.createEntry(base);
  }

  private createHeader(): TuiSessionSnapshotHeader {
    const firstTimestamp = this.entries[0]?.timestamp;
    const timestamp = typeof firstTimestamp === 'number'
      ? new Date(firstTimestamp).toISOString()
      : new Date(0).toISOString();
    return {
      type: 'session',
      version: 3,
      id: this.getSessionKey(),
      timestamp,
      cwd: this.getCwdValue(),
    };
  }

  private createTree(): TuiSessionSnapshotTreeNode[] {
    const nodeMap = new Map<string, TuiSessionSnapshotTreeNode>();
    const roots: TuiSessionSnapshotTreeNode[] = [];
    for (const entry of this.entries) {
      nodeMap.set(entry.id, {
        entry,
        children: [],
        label: entry.userLabel,
        labelTimestamp: entry.labelTimestamp,
      });
    }
    for (const entry of this.entries) {
      const node = nodeMap.get(entry.id);
      if (!node) continue;
      if (!entry.parentId || entry.parentId === entry.id) {
        roots.push(node);
        continue;
      }
      const parent = nodeMap.get(entry.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
    const stack = [...roots];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      node.children.sort((a, b) => (a.entry.timestamp ?? 0) - (b.entry.timestamp ?? 0));
      stack.push(...node.children);
    }
    return roots;
  }

  private createEntry(
    entry: Omit<TuiSessionSnapshotEntry, 'id' | 'parentId'> & {
      id?: string;
      parentId?: string | null;
    },
  ): TuiSessionSnapshotEntry {
    return {
      ...entry,
      id: entry.id ?? `tui:${this.nextId++}`,
      parentId: entry.parentId ?? this.entries[this.entries.length - 1]?.id ?? null,
    };
  }
}
