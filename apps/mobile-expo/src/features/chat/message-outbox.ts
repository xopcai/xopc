import { storage } from '../../storage/mmkv';

import type { Message } from './messages.types';
import type { MessageSubmission } from './message-submission';

const PREFIX = 'chat.messageOutbox:v1:';
const MAX_RECORDS_PER_SESSION = 50;

export type OutboxRecord = {
  submission: MessageSubmission;
  createdAt: number;
  deliveryState: Extract<Message['deliveryState'], 'sending' | 'confirming' | 'failed'>;
  lastAttemptAt?: number;
};

function storageKey(scope: string): string {
  return `${PREFIX}${encodeURIComponent(scope)}`;
}

export function readMessageOutbox(scope: string): OutboxRecord[] {
  try {
    const parsed = JSON.parse(storage.getString(storageKey(scope)) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is OutboxRecord => {
      if (!value || typeof value !== 'object') return false;
      const record = value as Partial<OutboxRecord>;
      return Boolean(
        record.submission
        && typeof record.submission.clientMessageId === 'string'
        && typeof record.submission.gatewayId === 'string'
        && typeof record.submission.conversationId === 'string'
        && typeof record.createdAt === 'number',
      );
    });
  } catch {
    return [];
  }
}

function writeMessageOutbox(scope: string, records: OutboxRecord[]): void {
  if (records.length === 0) {
    storage.delete(storageKey(scope));
    return;
  }
  storage.set(storageKey(scope), JSON.stringify(records.slice(-MAX_RECORDS_PER_SESSION)));
}

function durableSubmission(submission: MessageSubmission): MessageSubmission {
  return {
    ...submission,
    attachments: submission.attachments.map((attachment) => {
      // Native file references are durable enough for replay and avoid putting
      // multi-megabyte base64 payloads on MMKV's synchronous write path.
      if (attachment.localUri && attachment.data) {
        const withoutInlineData = { ...attachment };
        delete withoutInlineData.data;
        return withoutInlineData;
      }
      return attachment;
    }),
  };
}

export function upsertMessageOutbox(
  scope: string,
  submission: MessageSubmission,
  deliveryState: OutboxRecord['deliveryState'],
  createdAt = Date.now(),
): void {
  const records = readMessageOutbox(scope);
  const index = records.findIndex(record => record.submission.clientMessageId === submission.clientMessageId);
  const next: OutboxRecord = {
    submission: durableSubmission(submission),
    createdAt: index >= 0 ? records[index]!.createdAt : createdAt,
    deliveryState,
    lastAttemptAt: Date.now(),
  };
  if (index >= 0) records[index] = next;
  else records.push(next);
  writeMessageOutbox(scope, records);
}

export function removeMessageOutbox(scope: string, clientMessageId: string): void {
  writeMessageOutbox(
    scope,
    readMessageOutbox(scope).filter(record => record.submission.clientMessageId !== clientMessageId),
  );
}

export function confirmOutboxMessages(scope: string, clientMessageIds: Iterable<string>): void {
  const confirmed = new Set(clientMessageIds);
  if (confirmed.size === 0) return;
  writeMessageOutbox(
    scope,
    readMessageOutbox(scope).filter(record => !confirmed.has(record.submission.clientMessageId)),
  );
}
