import {
  deleteNote,
  moveNoteToGroup,
  quickCaptureNote,
  recordNoteOpen,
  updateNote,
} from '../query/notes';

import { createOfflineQueue, type DeadLetterOperation, type QueuedOperation } from './offline-queue';
import { appendSyncJournalEntry } from './sync-journal';

export type WorkspaceSyncOperation =
  | { type: 'capture'; text: string }
  | { type: 'update_note'; noteId: string; patch: Record<string, unknown> }
  | { type: 'delete_note'; noteId: string }
  | { type: 'move_note'; noteId: string; groupId: string | null }
  | { type: 'mark_opened'; noteId: string };

async function processWorkspaceOperation(operation: QueuedOperation<WorkspaceSyncOperation>): Promise<void> {
  const payload = operation.payload;

  switch (payload.type) {
    case 'capture':
      await quickCaptureNote(payload.text);
      return;
    case 'update_note':
      await updateNote(payload.noteId, payload.patch);
      return;
    case 'delete_note':
      await deleteNote(payload.noteId);
      return;
    case 'move_note':
      await moveNoteToGroup(payload.noteId, payload.groupId);
      return;
    case 'mark_opened':
      await recordNoteOpen(payload.noteId);
      return;
    default: {
      const exhaustiveCheck: never = payload;
      throw new Error(`Unsupported workspace sync operation: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

const workspaceSyncQueue = createOfflineQueue<WorkspaceSyncOperation>({
  namespace: 'workspace:sync',
  processor: processWorkspaceOperation,
  maxRetries: 8,
});

export type WorkspaceSyncStatus = {
  pendingCount: number;
  failedCount: number;
};

const statusListeners = new Set<() => void>();

function notifyWorkspaceSyncStatus(): void {
  statusListeners.forEach((listener) => listener());
}

export function subscribeWorkspaceSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function getWorkspaceSyncStatus(): WorkspaceSyncStatus {
  return {
    pendingCount: workspaceSyncQueue.pendingCount(),
    failedCount: workspaceSyncQueue.deadLetterCount(),
  };
}

export function queueWorkspaceOperation(operation: WorkspaceSyncOperation): string {
  const operationId = workspaceSyncQueue.enqueue(operation);
  const entity = operation.type === 'update_note' || operation.type === 'delete_note' || operation.type === 'move_note' || operation.type === 'mark_opened'
    ? 'note'
    : 'note';
  const entityId = 'noteId' in operation ? operation.noteId : `local:${operationId}`;
  const kind = operation.type === 'capture' ? 'create_note' : operation.type;
  appendSyncJournalEntry({
    id: operationId,
    entity,
    entityId,
    kind,
    payload: operation.type === 'capture' ? { text: operation.text } : operation,
    localVersion: 1,
    dependsOn: [],
  });
  notifyWorkspaceSyncStatus();
  return operationId;
}

export function queueWorkspaceCapture(text: string): string {
  return queueWorkspaceOperation({ type: 'capture', text });
}

export async function flushPendingWorkspaceOperations(): Promise<number> {
  try {
    return await workspaceSyncQueue.flush();
  } finally {
    notifyWorkspaceSyncStatus();
  }
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
  if (retried) notifyWorkspaceSyncStatus();
  return retried;
}

export function removeWorkspaceSyncOperation(operationId: string): void {
  workspaceSyncQueue.remove(operationId);
  notifyWorkspaceSyncStatus();
}

export function removeWorkspaceSyncDeadLetter(operationId: string): void {
  workspaceSyncQueue.removeDeadLetter(operationId);
  notifyWorkspaceSyncStatus();
}

export function clearWorkspaceSyncQueue(): void {
  workspaceSyncQueue.clear();
  notifyWorkspaceSyncStatus();
}

export function clearWorkspaceSyncDeadLetters(): void {
  workspaceSyncQueue.clearDeadLetters();
  notifyWorkspaceSyncStatus();
}
