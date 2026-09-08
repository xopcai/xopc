import { randomUUID } from 'node:crypto';

import { BrowserAutomationDefinitionSchema } from './schema.js';
import { resolveBrowserAutomationInputs } from './runner.js';
import {
  appendBrowserAutomationRunEvent,
  deleteBrowserAutomation,
  getBrowserAutomation,
  getBrowserAutomationRun,
  hasActiveBrowserAutomationRuns,
  listActiveBrowserAutomationRuns,
  listBrowserAutomationRunEvents,
  listBrowserAutomationRuns,
  listBrowserAutomations,
  nextBrowserAutomationRunEventSeq,
  saveBrowserAutomation,
  saveBrowserAutomationRun,
} from './repository.js';
import type { BrowserAutomation, BrowserAutomationDefinition, BrowserAutomationRun, BrowserAutomationStatus } from './types.js';

export type BrowserAutomationExecutor = (input: {
  definition: BrowserAutomationDefinition;
  inputs: Record<string, unknown>;
  signal: AbortSignal;
  onStep: (event: unknown) => void;
}) => Promise<{ ok: boolean; result?: unknown; error?: string }>;

export class BrowserAutomationService {
  private activeRuns = new Map<string, AbortController>();
  private executions = new Map<string, Promise<void>>();
  private waiters = new Map<string, Set<(run: BrowserAutomationRun) => void>>();

  constructor(private readonly executor: BrowserAutomationExecutor, private readonly emit?: (type: string, payload: unknown) => void) {
    for (const run of listActiveBrowserAutomationRuns()) {
      const endedAtMs = Date.now();
      saveBrowserAutomationRun({ ...run, status: 'failed', error: 'Gateway stopped before the run completed.', endedAtMs, durationMs: run.startedAtMs ? endedAtMs - run.startedAtMs : undefined });
    }
  }

  list() { return listBrowserAutomations(); }
  get(id: string) { return getBrowserAutomation(id); }
  listRuns(automationId?: string) { return listBrowserAutomationRuns(automationId); }
  getRun(id: string) { return getBrowserAutomationRun(id); }
  listRunEvents(id: string) { return listBrowserAutomationRunEvents(id); }
  validate(definition: unknown) { return BrowserAutomationDefinitionSchema.safeParse(definition); }

  save(input: { definition: unknown; status?: BrowserAutomationStatus; expectedId?: string }): BrowserAutomation {
    const parsed = BrowserAutomationDefinitionSchema.parse(input.definition);
    if (input.expectedId && parsed.id !== input.expectedId) throw new Error('Browser automation id cannot change.');
    const existing = getBrowserAutomation(parsed.id);
    const now = Date.now();
    const automation: BrowserAutomation = { id: parsed.id, revision: (existing?.revision ?? 0) + 1, status: input.status ?? existing?.status ?? 'enabled', definition: parsed, createdAtMs: existing?.createdAtMs ?? now, updatedAtMs: now };
    saveBrowserAutomation(automation);
    return automation;
  }

  remove(id: string): boolean {
    if (hasActiveBrowserAutomationRuns(id)) throw new Error('Cannot delete a running browser automation.');
    return deleteBrowserAutomation(id);
  }

  startRun(automationId: string, inputs: Record<string, unknown>): BrowserAutomationRun {
    const automation = getBrowserAutomation(automationId);
    if (!automation) throw new Error('Browser automation not found.');
    if (automation.status !== 'enabled') throw new Error('Browser automation is disabled.');
    const resolvedInputs = resolveBrowserAutomationInputs(automation.definition, inputs);
    const run: BrowserAutomationRun = { id: randomUUID(), automationId, automationRevision: automation.revision, definition: automation.definition, status: 'queued', inputs: resolvedInputs, createdAtMs: Date.now() };
    saveBrowserAutomationRun(run);
    this.addEvent(run.id, 'run.queued', { automationId });
    const execution = this.execute(run);
    this.executions.set(run.id, execution);
    void execution.finally(() => this.executions.delete(run.id)).catch(() => undefined);
    return run;
  }

  cancel(runId: string): boolean { const active = this.activeRuns.get(runId); if (!active) return false; active.abort(); return true; }
  async shutdown(): Promise<void> { for (const active of this.activeRuns.values()) active.abort(); await Promise.allSettled(this.executions.values()); }

  async runAndWait(automationId: string, inputs: Record<string, unknown>, signal?: AbortSignal): Promise<BrowserAutomationRun> {
    const run = this.startRun(automationId, inputs);
    return new Promise((resolve) => {
      const complete = (value: BrowserAutomationRun) => { signal?.removeEventListener('abort', onAbort); resolve(value); };
      const onAbort = () => this.cancel(run.id);
      const set = this.waiters.get(run.id) ?? new Set();
      set.add(complete);
      this.waiters.set(run.id, set);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  private addEvent(runId: string, type: string, data?: unknown): void {
    const event = { id: randomUUID(), runId, seq: nextBrowserAutomationRunEventSeq(runId), type, data, createdAtMs: Date.now() };
    appendBrowserAutomationRunEvent(event);
    this.emit?.(`browser.automation.${type}`, event);
  }

  private async execute(run: BrowserAutomationRun): Promise<void> {
    const controller = new AbortController();
    this.activeRuns.set(run.id, controller);
    const startedAtMs = Date.now();
    let current: BrowserAutomationRun = { ...run, status: 'running', startedAtMs };
    saveBrowserAutomationRun(current);
    this.addEvent(run.id, 'run.started');
    try {
      const outcome = await this.executor({ definition: run.definition, inputs: run.inputs, signal: controller.signal, onStep: (event) => this.addEvent(run.id, 'step', event) });
      const endedAtMs = Date.now();
      current = { ...current, status: controller.signal.aborted ? 'cancelled' : outcome.ok ? 'succeeded' : 'failed', result: outcome.result, error: outcome.error, endedAtMs, durationMs: endedAtMs - startedAtMs };
    } catch (error) {
      const endedAtMs = Date.now();
      current = { ...current, status: controller.signal.aborted ? 'cancelled' : 'failed', error: error instanceof Error ? error.message : String(error), endedAtMs, durationMs: endedAtMs - startedAtMs };
    }
    saveBrowserAutomationRun(current);
    this.addEvent(run.id, 'run.completed', { status: current.status, error: current.error });
    this.activeRuns.delete(run.id);
    for (const waiter of this.waiters.get(run.id) ?? []) waiter(current);
    this.waiters.delete(run.id);
  }
}
