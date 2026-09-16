type BindingRecord = {
  accountId: string;
  conversationId: string;
  parentConversationId?: string;
  targetConversationId: string;
  boundAt: number;
  lastActivityAt: number;
  metadata?: Record<string, unknown>;
};

type State = {
  byAccountConversation: Map<string, BindingRecord>;
};

const STATE_KEY = Symbol.for('xopc.feishuThreadBindingsState');

function getState(): State {
  const store = globalThis as Record<PropertyKey, unknown>;
  let st = store[STATE_KEY] as State | undefined;
  if (!st) {
    st = { byAccountConversation: new Map() };
    store[STATE_KEY] = st;
  }
  return st;
}

function key(accountId: string, conversationId: string): string {
  return `${accountId}:${conversationId}`;
}

export function bindFeishuConversation(params: {
  accountId: string;
  conversationId: string;
  parentConversationId?: string;
  targetConversationId: string;
  metadata?: Record<string, unknown>;
}): BindingRecord {
  const now = Date.now();
  const rec: BindingRecord = {
    accountId: params.accountId,
    conversationId: params.conversationId,
    parentConversationId: params.parentConversationId,
    targetConversationId: params.targetConversationId,
    boundAt: now,
    lastActivityAt: now,
    metadata: params.metadata,
  };
  getState().byAccountConversation.set(key(rec.accountId, rec.conversationId), rec);
  return rec;
}

export function listBindingsByConversationId(accountId: string, targetConversationId: string): BindingRecord[] {
  const out: BindingRecord[] = [];
  for (const rec of getState().byAccountConversation.values()) {
    if (rec.accountId === accountId && rec.targetConversationId === targetConversationId) out.push(rec);
  }
  return out;
}

export function unbindByConversationId(accountId: string, targetConversationId: string): BindingRecord[] {
  const removed: BindingRecord[] = [];
  for (const rec of getState().byAccountConversation.values()) {
    if (rec.accountId !== accountId || rec.targetConversationId !== targetConversationId) continue;
    getState().byAccountConversation.delete(key(rec.accountId, rec.conversationId));
    removed.push(rec);
  }
  return removed;
}
