import {
  deleteNote,
  moveNoteToGroup,
  quickCaptureNote,
  recordNoteOpen,
  updateNote,
} from '../query/notes';

import { createOfflineQueue, type DeadLetterOperation, type QueuedOperation } from './offline-queue';
import {
  appendSyncJournalEntry,
  removeSyncJournalEntry,
  updateSyncJournalEntry,
} from './sync-journal';

export type WorkspaceSyncOperation =
  | { type: 'capture'; text: string; channel: 'app' | 'clipboard' | 'share' }
  | { type: 'update_note'; noteId: string; patch: Record<string, unknown> }
  | { type: 'delete_note'; noteId: string }
  | { type: 'move_note'; noteId: string; groupId: string | null }
  | { type: 'mark_opened'; noteId: string };

const WORKSPACE_SYNC_MAX_RETRIES = 8;
const captureResultRequests = new Set<string>();
const captureResultIds = new Map<string, string>();
let flushPromise: Promise<number> | null = null;

function rememberCaptureResult(operationId: string, noteId: string): void {
  if (!captureResultRequests.has(operationId)) return;
  captureResultIds.set(operationId, noteId);
}

async function processWorkspaceOperation(operation: QueuedOperation<WorkspaceSyncOperation>): Promise<void> {
  const payload = operation.payload;

  updateSyncJournalEntry(operation.id, { state: 'syncing', error: undefined });

  try {
    switch (payload.type) {
      case 'capture':
        rememberCaptureResult(operation.id, (await quickCaptureNote(payload.text, {
          channel: payload.channel,
          idempotencyKey: operation.id,
        })).note.id);
        break;
      case 'update_note':
        await updateNote(payload.noteId, payload.patch);
        break;
      case 'delete_note':
        await deleteNote(payload.noteId);
        break;
      case 'move_note':
        await moveNoteToGroup(payload.noteId, payload.groupId);
        break;
      case 'mark_opened':
        await recordNoteOpen(payload.noteId);
        break;
      default: {
        const exhaustiveCheck: never = payload;
        throw new Error(`Unsupported workspace sync operation: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
    removeSyncJournalEntry(operation.id);
  } catch (error) {
    updateSyncJournalEntry(operation.id, {
      state: operation.retryCount + 1 >= WORKSPACE_SYNC_MAX_RETRIES ? 'failed' : 'pending',
      retryCount: operation.retryCount + 1,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

const workspaceSyncQueue = createOfflineQueue<WorkspaceSyncOperation>({
  namespace: 'workspace:sync',
  processor: processWorkspaceOperation,
  maxRetries: WORKSPACE_SYNC_MAX_RETRIES,
});

export type WorkspaceSyncStatus = {
  pendingCount: number;
  failedCount: number;
};

const statusListeners = new Set<() => void>();
let workspaceSyncStatus: WorkspaceSyncStatus | undefined;

function notifyWorkspaceSyncStatus(): void {
  getWorkspaceSyncStatus();
  statusListeners.forEach((listener) => listener());
}

export function subscribeWorkspaceSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function getWorkspaceSyncStatus(): WorkspaceSyncStatus {
  const pendingCount = workspaceSyncQueue.pendingCount();
  const failedCount = workspaceSyncQueue.deadLetterCount();

  if (!workspaceSyncStatus
    || pendingCount !== workspaceSyncStatus.pendingCount
    || failedCount !== workspaceSyncStatus.failedCount) {
    workspaceSyncStatus = { pendingCount, failedCount };
  }

  return workspaceSyncStatus;
}

export function queueWorkspaceOperation(operation: WorkspaceSyncOperation): string {
  const operationId = workspaceSyncQueue.enqueue(operation);
  const entityId = 'noteId' in operation ? operation.noteId : `local:${operationId}`;
  const kind = operation.type === 'capture' ? 'create_note' : operation.type;
  appendSyncJournalEntry({
    id: operationId,
    entity: 'note',
    entityId,
    kind,
    payload: operation.type === 'capture' ? { text: operation.text } : operation,
    localVersion: 1,
    dependsOn: [],
  });
  notifyWorkspaceSyncStatus();
  return operationId;
}

export type WorkspaceCaptureInput = {
  text: string;
  channel: 'app' | 'clipboard' | 'share';
};

export function queueWorkspaceCapture(input: WorkspaceCaptureInput): string {
  const text = input.text.trim();
  if (!text) throw new Error('Capture text is required');
  return queueWorkspaceOperation({ type: 'capture', text, channel: input.channel });
}

export async function captureWorkspaceText(input: WorkspaceCaptureInput): Promise<{
  operationId: string;
  synced: boolean;
  noteId?: string;
}> {
  const operationId = queueWorkspaceCapture(input);
  captureResultRequests.add(operationId);
  try {
    await flushPendingWorkspaceOperations();
    const synced = !workspaceSyncQueue.pending().some((operation) => operation.id === operationId)
      && !workspaceSyncQueue.deadLetters().some((operation) => operation.id === operationId);
    const noteId = captureResultIds.get(operationId);
    return { operationId, synced, ...(noteId ? { noteId } : {}) };
  } finally {
    captureResultRequests.delete(operationId);
    captureResultIds.delete(operationId);
  }
}

export async function flushPendingWorkspaceOperations(): Promise<number> {
  if (flushPromise) return flushPromise;
  flushPromise = workspaceSyncQueue.flush().finally(() => {
    flushPromise = null;
    notifyWorkspaceSyncStatus();
  });
  return flushPromise;
}

export function getPendingWorkspaceOperationCount(): number {
  return workspaceSyncQueue.pendingCount();
}

export function getPendingWorkspaceOperations(): QueuedOperation<WorkspaceSyncOperation>[] {
  return workspaceSyncQueue.pending();
}

export function getWorkspaceSyncDeadLetters(): DeadLetterOperation<WorkspaceSyncOperation>[] {
  return workspaceSyncQueue.deadLetters();
}

export function retryWorkspaceSyncDeadLetter(operationId: string): boolean {
  const retried = workspaceSyncQueue.retryDeadLetter(operationId);
  if (retried) {
    updateSyncJournalEntry(operationId, { state: 'pending', retryCount: 0, error: undefined });
    notifyWorkspaceSyncStatus();
  }
  return retried;
}

export function removeWorkspaceSyncOperation(operationId: string): void {
  workspaceSyncQueue.remove(operationId);
  removeSyncJournalEntry(operationId);
  notifyWorkspaceSyncStatus();
}

export function removeWorkspaceSyncDeadLetter(operationId: string): void {
  workspaceSyncQueue.removeDeadLetter(operationId);
  removeSyncJournalEntry(operationId);
  notifyWorkspaceSyncStatus();
}

export function clearWorkspaceSyncQueue(): void {
  workspaceSyncQueue.pending().forEach((operation) => removeSyncJournalEntry(operation.id));
  workspaceSyncQueue.clear();
  notifyWorkspaceSyncStatus();
}

export function clearWorkspaceSyncDeadLetters(): void {
  workspaceSyncQueue.deadLetters().forEach((operation) => removeSyncJournalEntry(operation.id));
  workspaceSyncQueue.clearDeadLetters();
  notifyWorkspaceSyncStatus();
}
