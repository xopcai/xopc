/**
 * Generic offline operation queue backed by MMKV.
 *
 * Design principles:
 *  - Operations are persisted immediately on enqueue (survives app crash).
 *  - Flush processes operations FIFO; stops on first failure (preserves ordering).
 *  - Each operation carries a retry count for backoff / dead-letter decisions.
 *  - Callers provide a `processor` function that performs the actual network call.
 *
 * Usage:
 *   const queue = createOfflineQueue<CapturePayload>({
 *     namespace: 'notes:capture',
 *     processor: async (op) => { await apiCall(op.payload); },
 *   });
 *   queue.enqueue({ text: 'hello' });
 *   const flushed = await queue.flush();
 */
import { storage } from '../storage/mmkv';

// ── Types ───────────────────────────────────────────────────

export interface QueuedOperation<T> {
  id: string;
  payload: T;
  createdAt: number;
  retryCount: number;
}

export interface DeadLetterOperation<T> extends QueuedOperation<T> {
  failedAt: number;
  reason?: string;
}

export type OperationProcessor<T> = (operation: QueuedOperation<T>) => Promise<void>;

export interface OfflineQueueOptions<T> {
  /** Unique namespace prefix for MMKV keys (e.g. 'notes:capture'). */
  namespace: string;
  /** Async function that processes a single operation. Throw to signal failure. */
  processor: OperationProcessor<T>;
  /** Max retries before marking as dead-letter. Default: 5. */
  maxRetries?: number;
}

export interface OfflineQueue<T> {
  /** Add an operation to the queue. Returns the operation ID. */
  enqueue: (payload: T) => string;
  /** Process all pending operations in FIFO order. Returns count of successfully processed. */
  flush: () => Promise<number>;
  /** Get count of pending operations. */
  pendingCount: () => number;
  /** Get all pending operations (for display). */
  pending: () => QueuedOperation<T>[];
  /** Get operations that exceeded retry budget. */
  deadLetters: () => DeadLetterOperation<T>[];
  /** Get count of operations that exceeded retry budget. */
  deadLetterCount: () => number;
  /** Retry a dead-letter operation by moving it back to the pending queue. */
  retryDeadLetter: (operationId: string) => boolean;
  /** Remove a specific operation by ID (e.g. user cancelled). */
  remove: (operationId: string) => void;
  /** Remove a specific dead-letter operation by ID. */
  removeDeadLetter: (operationId: string) => void;
  /** Clear all pending operations. */
  clear: () => void;
  /** Clear all dead-letter operations. */
  clearDeadLetters: () => void;
}

// ── Implementation ──────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseJson<R>(raw: string | undefined): R | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as R;
  } catch {
    return null;
  }
}

export function createOfflineQueue<T>(options: OfflineQueueOptions<T>): OfflineQueue<T> {
  const { namespace, processor, maxRetries = 5 } = options;
  const idsKey = `${namespace}:ids`;
  const deadLetterIdsKey = `${namespace}:dead-letter-ids`;
  const opPrefix = `${namespace}:op:`;
  const deadLetterPrefix = `${namespace}:dead-letter:`;

  function readIds(): string[] {
    return parseJson<string[]>(storage.getString(idsKey)) ?? [];
  }

  function writeIds(ids: string[]): void {
    storage.set(idsKey, JSON.stringify(ids));
  }

  function readDeadLetterIds(): string[] {
    return parseJson<string[]>(storage.getString(deadLetterIdsKey)) ?? [];
  }

  function writeDeadLetterIds(ids: string[]): void {
    storage.set(deadLetterIdsKey, JSON.stringify(ids));
  }

  function opStorageKey(id: string): string {
    return `${opPrefix}${id}`;
  }

  function deadLetterStorageKey(id: string): string {
    return `${deadLetterPrefix}${id}`;
  }

  function readOp(id: string): QueuedOperation<T> | null {
    return parseJson<QueuedOperation<T>>(storage.getString(opStorageKey(id)));
  }

  function readDeadLetter(id: string): DeadLetterOperation<T> | null {
    return parseJson<DeadLetterOperation<T>>(storage.getString(deadLetterStorageKey(id)));
  }

  function writeOp(op: QueuedOperation<T>): void {
    storage.set(opStorageKey(op.id), JSON.stringify(op));
  }

  function writeDeadLetter(op: DeadLetterOperation<T>): void {
    storage.set(deadLetterStorageKey(op.id), JSON.stringify(op));
    const ids = readDeadLetterIds();
    if (!ids.includes(op.id)) {
      ids.push(op.id);
      writeDeadLetterIds(ids);
    }
  }

  function deleteOp(id: string): void {
    storage.delete(opStorageKey(id));
  }

  function deleteDeadLetter(id: string): void {
    storage.delete(deadLetterStorageKey(id));
  }

  function errorReason(error: unknown): string | undefined {
    return error instanceof Error ? error.message : undefined;
  }

  function moveToDeadLetter(operation: QueuedOperation<T>, reason?: string): void {
    writeDeadLetter({
      ...operation,
      failedAt: Date.now(),
      reason,
    });
    deleteOp(operation.id);
  }

  const queue: OfflineQueue<T> = {
    enqueue(payload: T): string {
      const id = generateId();
      const operation: QueuedOperation<T> = {
        id,
        payload,
        createdAt: Date.now(),
        retryCount: 0,
      };
      writeOp(operation);
      const ids = readIds();
      ids.push(id);
      writeIds(ids);
      return id;
    },

    async flush(): Promise<number> {
      const ids = readIds();
      let flushed = 0;
      const remainingIds: string[] = [];

      for (const id of ids) {
        const operation = readOp(id);
        if (!operation) {
          // Orphaned ID — skip
          continue;
        }

        if (operation.retryCount >= maxRetries) {
          moveToDeadLetter(operation, 'retry limit exceeded');
          continue;
        }

        try {
          await processor(operation);
          deleteOp(id);
          flushed++;
        } catch (error) {
          operation.retryCount++;
          if (operation.retryCount >= maxRetries) {
            moveToDeadLetter(operation, errorReason(error));
          } else {
            writeOp(operation);
            remainingIds.push(id);
          }
          // Stop on first failure to preserve ordering
          // Append remaining un-attempted IDs
          const currentIndex = ids.indexOf(id);
          remainingIds.push(...ids.slice(currentIndex + 1));
          break;
        }
      }

      writeIds(remainingIds);
      return flushed;
    },

    pendingCount(): number {
      return readIds().length;
    },

    pending(): QueuedOperation<T>[] {
      const ids = readIds();
      const results: QueuedOperation<T>[] = [];
      for (const id of ids) {
        const op = readOp(id);
        if (op) results.push(op);
      }
      return results;
    },

    deadLetters(): DeadLetterOperation<T>[] {
      const ids = readDeadLetterIds();
      const results: DeadLetterOperation<T>[] = [];
      for (const id of ids) {
        const op = readDeadLetter(id);
        if (op) results.push(op);
      }
      return results;
    },

    deadLetterCount(): number {
      return this.deadLetters().length;
    },

    retryDeadLetter(operationId: string): boolean {
      const operation = readDeadLetter(operationId);
      if (!operation) return false;

      const queuedOperation: QueuedOperation<T> = {
        id: operation.id,
        payload: operation.payload,
        createdAt: operation.createdAt,
        retryCount: 0,
      };
      writeOp(queuedOperation);
      deleteDeadLetter(operationId);
      writeDeadLetterIds(readDeadLetterIds().filter((id) => id !== operationId));
      const ids = readIds();
      if (!ids.includes(operationId)) {
        ids.push(operationId);
        writeIds(ids);
      }
      return true;
    },

    remove(operationId: string): void {
      deleteOp(operationId);
      const ids = readIds().filter((id) => id !== operationId);
      writeIds(ids);
    },

    removeDeadLetter(operationId: string): void {
      deleteDeadLetter(operationId);
      const ids = readDeadLetterIds().filter((id) => id !== operationId);
      writeDeadLetterIds(ids);
    },

    clear(): void {
      const ids = readIds();
      for (const id of ids) deleteOp(id);
      writeIds([]);
    },

    clearDeadLetters(): void {
      const ids = readDeadLetterIds();
      for (const id of ids) deleteDeadLetter(id);
      writeDeadLetterIds([]);
    },
  };

  return queue;
}
