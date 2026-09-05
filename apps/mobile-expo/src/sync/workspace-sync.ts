import {
  deleteNote,
  moveNoteToGroup,
  quickCaptureNote,
  recordNoteOpen,
  updateNote,
} from '../query/notes';
import { isGatewayConnectivityError } from '../api/gateway-error';
import { captureNoteWithVoice } from '../features/notes/capture-note-media';
import { deleteRecordingFile } from '../features/chat/voiceRecording';

import { createOfflineQueue, type DeadLetterOperation, type QueuedOperation } from './offline-queue';
import {
  appendSyncJournalEntry,
  removeSyncJournalEntry,
  updateSyncJournalEntry,
} from './sync-journal';

export type WorkspaceSyncOperation =
  | { type: 'capture'; text: string; channel: 'app' | 'clipboard' | 'share' }
  | { type: 'capture_voice'; uri: string; durationMillis: number; mimeType: string }
  | { type: 'update_note'; noteId: string; patch: Record<string, unknown> }
  | { type: 'delete_note'; noteId: string }
  | { type: 'move_note'; noteId: string; groupId: string | null }
  | { type: 'mark_opened'; noteId: string };

const WORKSPACE_SYNC_MAX_RETRIES = 8;
const captureResultRequests = new Set<string>();
const captureResultIds = new Map<string, string>();
let flushPromise: Promise<number> | null = null;
let activeOperationId: string | null = null;

function shouldCountWorkspaceRetry(error: unknown): boolean {
  return !isGatewayConnectivityError(error)
    || !['offline-network', 'no-route']
      .includes(error.kind);
}

function rememberCaptureResult(operationId: string, noteId: string): void {
  if (!captureResultRequests.has(operationId)) return;
  captureResultIds.set(operationId, noteId);
}

async function processWorkspaceOperation(operation: QueuedOperation<WorkspaceSyncOperation>): Promise<void> {
  activeOperationId = operation.id;
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
      case 'capture_voice':
        rememberCaptureResult(operation.id, (await captureNoteWithVoice({
          uri: payload.uri,
          durationMillis: payload.durationMillis,
          mimeType: payload.mimeType,
        }, { idempotencyKey: operation.id })).note.id);
        deleteRecordingFile(payload.uri);
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
    const retryCount = operation.retryCount + (shouldCountWorkspaceRetry(error) ? 1 : 0);
    updateSyncJournalEntry(operation.id, {
      state: retryCount >= WORKSPACE_SYNC_MAX_RETRIES ? 'failed' : 'pending',
      retryCount,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    activeOperationId = null;
  }
}

const workspaceSyncQueue = createOfflineQueue<WorkspaceSyncOperation>({
  namespace: 'workspace:sync',
  processor: processWorkspaceOperation,
  maxRetries: WORKSPACE_SYNC_MAX_RETRIES,
  shouldCountRetry: shouldCountWorkspaceRetry,
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
  const noteId = operation.type === 'update_note' ? operation.noteId : undefined;
  const superseded = operation.type === 'update_note'
    ? workspaceSyncQueue.pending().filter((item) => item.id !== activeOperationId
      && item.payload.type === 'update_note' && item.payload.noteId === noteId)
    : [];
  if (operation.type === 'update_note') {
    const patch = Object.assign({}, ...superseded.map((item) =>
      item.payload.type === 'update_note' ? item.payload.patch : {}), operation.patch);
    operation = { ...operation, patch };
  }
  const operationId = workspaceSyncQueue.enqueue(operation);
  for (const item of superseded) {
    workspaceSyncQueue.remove(item.id);
    removeSyncJournalEntry(item.id);
  }
  const entityId = 'noteId' in operation ? operation.noteId : `local:${operationId}`;
  const kind = operation.type === 'capture' || operation.type === 'capture_voice'
    ? 'create_note'
    : operation.type;
  appendSyncJournalEntry({
    id: operationId,
    entity: 'note',
    entityId,
    kind,
    payload: operation.type === 'capture'
      ? { text: operation.text }
      : operation.type === 'capture_voice'
        ? { kind: 'voice', durationMillis: operation.durationMillis, mimeType: operation.mimeType }
        : operation,
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

export type WorkspaceVoiceCaptureInput = {
  uri: string;
  durationMillis: number;
  mimeType: string;
};

export function queueWorkspaceVoiceCapture(input: WorkspaceVoiceCaptureInput): string {
  if (!input.uri.trim()) throw new Error('Voice capture URI is required');
  return queueWorkspaceOperation({
    type: 'capture_voice',
    uri: input.uri,
    durationMillis: input.durationMillis,
    mimeType: input.mimeType,
  });
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

export async function captureWorkspaceVoice(input: WorkspaceVoiceCaptureInput): Promise<{
  operationId: string;
  synced: boolean;
  noteId?: string;
}> {
  const operationId = queueWorkspaceVoiceCapture(input);
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
  const operation = workspaceSyncQueue.pending().find((item) => item.id === operationId);
  if (operation?.payload.type === 'capture_voice') deleteRecordingFile(operation.payload.uri);
  workspaceSyncQueue.remove(operationId);
  removeSyncJournalEntry(operationId);
  notifyWorkspaceSyncStatus();
}

export function removeWorkspaceSyncDeadLetter(operationId: string): void {
  const operation = workspaceSyncQueue.deadLetters().find((item) => item.id === operationId);
  if (operation?.payload.type === 'capture_voice') deleteRecordingFile(operation.payload.uri);
  workspaceSyncQueue.removeDeadLetter(operationId);
  removeSyncJournalEntry(operationId);
  notifyWorkspaceSyncStatus();
}

export function clearWorkspaceSyncQueue(): void {
  workspaceSyncQueue.pending().forEach((operation) => {
    if (operation.payload.type === 'capture_voice') deleteRecordingFile(operation.payload.uri);
    removeSyncJournalEntry(operation.id);
  });
  workspaceSyncQueue.clear();
  notifyWorkspaceSyncStatus();
}

export function clearWorkspaceSyncDeadLetters(): void {
  workspaceSyncQueue.deadLetters().forEach((operation) => {
    if (operation.payload.type === 'capture_voice') deleteRecordingFile(operation.payload.uri);
    removeSyncJournalEntry(operation.id);
  });
  workspaceSyncQueue.clearDeadLetters();
  notifyWorkspaceSyncStatus();
}
