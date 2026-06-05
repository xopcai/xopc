import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Config } from '../../config/schema.js';
import { createLogger } from '../../utils/logger.js';
import type { WorkflowEventEnvelope, WorkflowEventPayload, WorkflowEventType } from '../domain/event.js';

import { resolveWorkflowRunEventsPath, resolveWorkflowRunsDir } from './paths.js';

const log = createLogger('WorkflowEventStore');

export interface AppendWorkflowEventInput<T extends WorkflowEventPayload = WorkflowEventPayload> {
  runId: string;
  type: WorkflowEventType;
  payload: T;
  createdAtMs?: number;
}

export class WorkflowEventStore {
  constructor(
    private readonly config: Config,
    private readonly agentId: string,
  ) {}

  async append<T extends WorkflowEventPayload>(input: AppendWorkflowEventInput<T>): Promise<WorkflowEventEnvelope<T>> {
    const eventsPath = resolveWorkflowRunEventsPath(this.config, this.agentId, input.runId);
    await mkdir(dirname(eventsPath), { recursive: true });
    const previousEvents = await this.readRunEvents(input.runId);
    const event: WorkflowEventEnvelope<T> = {
      id: randomUUID(),
      runId: input.runId,
      sequence: previousEvents.length + 1,
      type: input.type,
      payload: input.payload,
      createdAtMs: input.createdAtMs ?? Date.now(),
    };

    await appendFile(eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
    return event;
  }

  async readRunEvents(runId: string): Promise<WorkflowEventEnvelope[]> {
    const eventsPath = resolveWorkflowRunEventsPath(this.config, this.agentId, runId);
    let content: string;
    try {
      content = await readFile(eventsPath, 'utf8');
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as NodeJS.ErrnoException).code) : '';
      if (code === 'ENOENT') {
        return [];
      }
      log.warn({ err, runId, eventsPath }, 'Workflow events read failed');
      return [];
    }

    const events: WorkflowEventEnvelope[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      try {
        const event = JSON.parse(line) as WorkflowEventEnvelope;
        if (event.runId === runId && Number.isFinite(event.sequence)) {
          events.push(event);
        }
      } catch (err) {
        log.warn({ err, runId, linePreview: line.slice(0, 160) }, 'Workflow event line parse failed');
      }
    }

    events.sort((left, right) => left.sequence - right.sequence);
    return events;
  }

  async listRunIds(): Promise<string[]> {
    const runsDir = resolveWorkflowRunsDir(this.config, this.agentId);
    let entries: string[];
    try {
      entries = await readdir(runsDir);
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as NodeJS.ErrnoException).code) : '';
      if (code === 'ENOENT') {
        return [];
      }
      log.warn({ err, runsDir }, 'Workflow runs directory read failed');
      return [];
    }

    return entries.filter((entry) => !entry.startsWith('.') && !entry.includes('/') && !entry.includes('\\'));
  }
}

export function createWorkflowEventStore(config: Config, agentId: string): WorkflowEventStore {
  return new WorkflowEventStore(config, agentId);
}
