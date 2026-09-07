import type { Config } from '../../config/schema.js';
import { projectWorkflowRunView } from '../engine/projector.js';
import type { WorkflowRunSummary, WorkflowRunView } from '../domain/run.js';

import { WorkflowEventStore } from './event-store.js';
import { WorkflowRunIndexStore } from './run-index-store.js';


export class WorkflowRunStore {
  private readonly eventStore: WorkflowEventStore;
  private readonly indexStore = new WorkflowRunIndexStore();

  constructor(
    config: Config,
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

    this.indexStore.upsert(this.agentId, view);
    return view;
  }

  async readRunView(runId: string): Promise<WorkflowRunView | null> {
    return this.rebuildRunView(runId);
  }

  async listRunSummaries(limit = 50, options: { projectId?: string } = {}): Promise<WorkflowRunSummary[]> {
    const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
    return this.indexStore.list(this.agentId, { limit: safeLimit, projectId: options.projectId });
  }

  async listRunSummariesForTask(taskId: string, limit = 50): Promise<WorkflowRunSummary[]> {
    const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
    return this.indexStore.list(this.agentId, { taskId, limit: safeLimit });
  }
}

export function createWorkflowRunStore(config: Config, agentId: string): WorkflowRunStore {
  return new WorkflowRunStore(config, agentId);
}
