import { randomUUID } from 'node:crypto';

import {
  createObjectLinkRecord,
  getActivityEventRecord,
  listActivityRecords,
  listObjectActivityRecords,
  listObjectLinkRecords,
  listProjectActivityRecords,
  recordActivityEvent,
} from '../storage/sqlite/index.js';
import type {
  ActivityEventWithRelations,
  ActivityListResult,
  ActivityObjectRef,
  CreateObjectLinkInput,
  ListActivityOptions,
  ListObjectActivityOptions,
  ListProjectActivityOptions,
  ObjectLink,
  RecordActivityInput,
} from './types.js';

function normalizeLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(100, Math.floor(limit ?? 50)));
}

function normalizeOffset(offset: number | undefined): number {
  return Math.max(0, Math.floor(offset ?? 0));
}

export class ActivityService {
  record(input: RecordActivityInput): ActivityEventWithRelations {
    return recordActivityEvent({
      ...input,
      id: input.id ?? randomUUID(),
      nowMs: input.nowMs ?? Date.now(),
    });
  }

  get(id: string): ActivityEventWithRelations | null {
    return getActivityEventRecord(id);
  }

  list(options: ListActivityOptions = {}): ActivityListResult {
    return listActivityRecords({
      ...options,
      limit: normalizeLimit(options.limit),
      offset: normalizeOffset(options.offset),
    });
  }

  listForObject(options: ListObjectActivityOptions): ActivityListResult {
    return listObjectActivityRecords({
      ...options,
      limit: normalizeLimit(options.limit),
      offset: normalizeOffset(options.offset),
    });
  }

  listForProject(options: ListProjectActivityOptions): ActivityListResult {
    return listProjectActivityRecords({
      ...options,
      limit: normalizeLimit(options.limit),
      offset: normalizeOffset(options.offset),
    });
  }
}

export class ObjectLinkService {
  create(input: CreateObjectLinkInput): ObjectLink {
    return createObjectLinkRecord({
      ...input,
      id: input.id ?? randomUUID(),
      nowMs: input.nowMs ?? Date.now(),
    });
  }

  listForObject(object: ActivityObjectRef): ObjectLink[] {
    return listObjectLinkRecords(object);
  }
}
