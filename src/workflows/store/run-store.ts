import { readFile } from 'node:fs/promises';

import type { Config } from '../../config/schema.js';
import { writeTextAtomic } from '../../infra/write-file-atomic.js';
import { createLogger } from '../../utils/logger.js';
import { projectWorkflowRunView } from '../engine/projector.js';
import type { WorkflowRunSummary, WorkflowRunView } from '../domain/run.js';

import { WorkflowEventStore } from './event-store.js';
import { resolveWorkflowRunViewPath } from './paths.js';

const log = createLogger('WorkflowRunStore');

export class WorkflowRunStore {
  private readonly eventStore: WorkflowEventStore;

  constructor(
    private readonly config: Config,
    private readonly agentId: string,
    eventStore?: WorkflowEventStore,
  ) {
    this.eventStore = eventStore ?? new WorkflowEventStore(config, agentId);
  }

  async rebuildRunView(runId: string): Promise<WorkflowRunView | null> {
    const events = await this.eventStore.readRunEvents(runId);
    const view = projectWorkflowRunView(events);
    if (!view) {
      return null;
    }

    const viewPath = resolveWorkflowRunViewPath(this.config, this.agentId, runId);
    await writeTextAtomic(viewPath, `${JSON.stringify(view, null, 2)}\n`);
    return view;
  }

  async readRunView(runId: string): Promise<WorkflowRunView | null> {
    const viewPath = resolveWorkflowRunViewPath(this.config, this.agentId, runId);
    try {
      const content = await readFile(viewPath, 'utf8');
      return JSON.parse(content) as WorkflowRunView;
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as NodeJS.ErrnoException).code) : '';
      if (code !== 'ENOENT') {
        log.debug({ err, runId, viewPath }, 'Workflow run view read failed; rebuilding from events');
      }
      return this.rebuildRunView(runId);
    }
  }

  async listRunSummaries(limit = 50): Promise<WorkflowRunSummary[]> {
    const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
    const runIds = await this.eventStore.listRunIds();
    const summaries: WorkflowRunSummary[] = [];
    for (const runId of runIds) {
      const view = await this.readRunView(runId);
      if (!view) {
        continue;
      }
      summaries.push({
        id: view.run.id,
        definitionId: view.run.definitionId,
        title: view.run.title,
        status: view.run.status,
        source: view.run.source,
        metadata: view.run.metadata,
        createdAtMs: view.run.createdAtMs,
        startedAtMs: view.run.startedAtMs,
        completedAtMs: view.run.completedAtMs,
        metrics: view.run.metrics,
      });
    }

    summaries.sort((left, right) => right.createdAtMs - left.createdAtMs);
    return summaries.slice(0, safeLimit);
  }
}

export function createWorkflowRunStore(config: Config, agentId: string): WorkflowRunStore {
  return new WorkflowRunStore(config, agentId);
}
