import {
  deleteNote,
  moveNoteToGroup,
  quickCaptureNote,
  recordNoteOpen,
  updateNote,
} from '../query/notes';

import { createOfflineQueue, type DeadLetterOperation, type QueuedOperation } from './offline-queue';

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

export function queueWorkspaceOperation(operation: WorkspaceSyncOperation): string {
  return workspaceSyncQueue.enqueue(operation);
}

export function queueWorkspaceCapture(text: string): string {
  return queueWorkspaceOperation({ type: 'capture', text });
}

export async function flushPendingWorkspaceOperations(): Promise<number> {
  return workspaceSyncQueue.flush();
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
  return workspaceSyncQueue.retryDeadLetter(operationId);
}

export function removeWorkspaceSyncOperation(operationId: string): void {
  workspaceSyncQueue.remove(operationId);
}

export function removeWorkspaceSyncDeadLetter(operationId: string): void {
  workspaceSyncQueue.removeDeadLetter(operationId);
}

export function clearWorkspaceSyncQueue(): void {
  workspaceSyncQueue.clear();
}

export function clearWorkspaceSyncDeadLetters(): void {
  workspaceSyncQueue.clearDeadLetters();
}
