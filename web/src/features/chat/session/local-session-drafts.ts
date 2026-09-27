import { canonicalSessionCommand, type SessionCreation, type SessionInputCommand } from '@xopcai/gateway-contract';
import { useGatewayStore } from '@/stores/gateway-store';
import type { SessionAgentConfig } from './session-manager';

export type LocalSessionDraft = {
  conversationId: string;
  creation: SessionCreation;
  createdAt: string;
  submission?: Omit<Extract<SessionInputCommand, { kind: 'start' }>, 'origin'>;
  materialization?: { commandId: string; purpose: 'voice' | 'session_resources' };
};
export type PendingSessionCommand = Omit<Extract<SessionInputCommand, { kind: 'start' }>, 'origin'>
  | Omit<Extract<SessionInputCommand, { kind: 'append' }>, 'origin'>;

let database: Promise<IDBDatabase> | undefined;
const temporarySessions = new Set<string>();
const memoryDrafts = new Map<string, LocalSessionDraft>();
const memoryCommands = new Map<string, PendingSessionCommand>();
const memoryTranscripts = new Map<string, string>();
const memoryComposers = new Map<string, unknown>();
function openDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('xopc-session-drafts', 2);
    request.onupgradeneeded = () => {
      for (const name of ['drafts', 'identities', 'commands', 'composers']) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}

function scope(): string {
  const gateway = useGatewayStore.getState();
  if (!gateway.conversationId) throw new Error('Sign in before opening a conversation');
  return gateway.conversationId;
}

function key(id: string): string { return `${scope()}:${id}`; }

/** Capture identity before asynchronous hydration or navigation. */
export function composerDraftStorage<T>(id: string): { read(): Promise<T | undefined>; write(draft: T | undefined): Promise<void> } {
  const storageKey = key(id);
  return {
    async read() {
      if (temporarySessions.has(storageKey)) return structuredClone(memoryComposers.get(storageKey)) as T | undefined;
      return transaction('readonly', store => store.get(storageKey), 'composers');
    },
    async write(draft) {
      if (temporarySessions.has(storageKey)) {
        if (draft === undefined) memoryComposers.delete(storageKey);
        else memoryComposers.set(storageKey, structuredClone(draft));
        return;
      }
      if (draft === undefined) await transaction('readwrite', store => store.delete(storageKey), 'composers');
      else await transaction('readwrite', store => store.put(draft, storageKey), 'composers');
    },
  };
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>, storeName = 'drafts'): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = operation(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? request.error ?? new Error('Draft persistence failed'));
    tx.onerror = () => reject(tx.error ?? request.error);
  });
}

export async function readLocalSessionDraft(id: string): Promise<LocalSessionDraft | undefined> {
  const storageKey = key(id);
  if (temporarySessions.has(storageKey)) return structuredClone(memoryDrafts.get(storageKey));
  return transaction('readonly', store => store.get(storageKey));
}

export async function saveLocalSessionDraft(draft: LocalSessionDraft): Promise<void> {
  const storageKey = key(draft.conversationId);
  if (draft.creation.temporary) {
    temporarySessions.add(storageKey);
    memoryDrafts.set(storageKey, structuredClone(draft));
    return;
  }
  temporarySessions.delete(storageKey);
  memoryDrafts.delete(storageKey);
  await transaction('readwrite', store => store.put(draft, storageKey));
}

export async function acknowledgeLocalSessionDraft(id: string): Promise<void> {
  const storageKey = key(id);
  if (temporarySessions.has(storageKey)) { memoryDrafts.delete(storageKey); return; }
  await transaction('readwrite', store => store.delete(storageKey));
}

export async function rememberSessionTranscript(id: string, transcriptId: string): Promise<void> {
  const storageKey = key(id);
  if (temporarySessions.has(storageKey)) { memoryTranscripts.set(storageKey, transcriptId); return; }
  await transaction('readwrite', store => store.put(transcriptId, storageKey), 'identities');
}

export async function readSessionTranscript(id: string): Promise<string | undefined> {
  const storageKey = key(id);
  if (temporarySessions.has(storageKey)) return memoryTranscripts.get(storageKey);
  return transaction('readonly', store => store.get(storageKey), 'identities');
}

export async function readPendingSessionCommand(id: string): Promise<PendingSessionCommand | undefined> {
  const storageKey = key(id);
  if (temporarySessions.has(storageKey)) return structuredClone(memoryCommands.get(storageKey));
  return transaction('readonly', store => store.get(storageKey), 'commands');
}

export async function savePendingSessionCommand(id: string, command: PendingSessionCommand): Promise<void> {
  const storageKey = key(id);
  if (temporarySessions.has(storageKey)) {
    const previous = memoryCommands.get(storageKey);
    if (previous && canonicalSessionCommand(previous) !== canonicalSessionCommand(command)) throw new Error('Another input is awaiting confirmation');
    memoryCommands.set(storageKey, structuredClone(command));
    return;
  }
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('commands', 'readwrite');
    const store = tx.objectStore('commands');
    const read = store.get(storageKey);
    read.onsuccess = () => {
      const existing = read.result as PendingSessionCommand | undefined;
      if (existing && canonicalSessionCommand(existing) !== canonicalSessionCommand(command)) { tx.abort(); return; }
      store.put(command, storageKey);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new Error('Another input is awaiting confirmation'));
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearPendingSessionCommand(id: string): Promise<void> {
  const storageKey = key(id);
  if (temporarySessions.has(storageKey)) { memoryCommands.delete(storageKey); return; }
  await transaction('readwrite', store => store.delete(storageKey), 'commands');
}

export async function confirmSessionCommand(id: string, transcriptId: string): Promise<void> {
  const storageKey = key(id);
  if (temporarySessions.has(storageKey)) {
    memoryTranscripts.set(storageKey, transcriptId); memoryDrafts.delete(storageKey); memoryCommands.delete(storageKey);
    return;
  }
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['drafts', 'identities', 'commands'], 'readwrite');
    tx.objectStore('identities').put(transcriptId, storageKey);
    tx.objectStore('drafts').delete(storageKey);
    tx.objectStore('commands').delete(storageKey);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Receipt persistence failed'));
    tx.onerror = () => reject(tx.error);
  });
}

export function draftAgentConfig(draft: LocalSessionDraft): SessionAgentConfig {
  return {
    localDraft: true,
    model: draft.creation.model, thinkingLevel: draft.creation.thinkingLevel,
    fixedModel: false, reasoningLevel: 'on',
    activityDetail: { default: 'on', override: null, effective: 'on', source: 'default' },
    effectiveWorkspacePath: '', workingDirectoryLocked: Boolean(draft.creation.projectId),
    workspaceSource: draft.creation.projectId ? 'project' : 'agent_default_root',
    userContextMode: draft.creation.temporary ? 'temporary' : 'enabled',
  };
}
