import { randomUUID } from 'node:crypto';

import { validateBrowserPipeline, type BrowserRecipeStepEvent } from '../pipeline/runner.js';
import type { BrowserActionRegistry, BrowserActionResult } from '../actions/types.js';
import {
  appendBrowserRecipeRunEvent,
  deleteBrowserRecipe,
  getBrowserRecipe,
  getBrowserRecipeRun,
  hasActiveBrowserRecipeRuns,
  listActiveBrowserRecipeRuns,
  listBrowserRecipeRunEvents,
  listBrowserRecipeRuns,
  listBrowserRecipes,
  nextBrowserRecipeRunEventSeq,
  saveBrowserRecipe,
  saveBrowserRecipeRun,
} from './repository.js';
import type { BrowserRecipe, BrowserRecipeRun, BrowserRecipeStatus } from './types.js';

export type BrowserRecipeExecutor = (input: { yaml: string; args: Record<string, unknown>; signal: AbortSignal; onStep: (event: BrowserRecipeStepEvent) => void }) => Promise<BrowserActionResult>;

export class BrowserRecipeService {
  private activeRuns = new Map<string, AbortController>();
  private executions = new Map<string, Promise<void>>();
  private runWaiters = new Map<string, Set<(run: BrowserRecipeRun) => void>>();

  constructor(private readonly registry: BrowserActionRegistry, private readonly executeRecipe: BrowserRecipeExecutor, private readonly emit?: (type: string, payload: unknown) => void) {
    for (const run of listActiveBrowserRecipeRuns()) {
      const endedAtMs = Date.now();
      const recovered = {
        ...run,
        status: 'failed' as const,
        error: 'Gateway stopped before the run completed',
        endedAtMs,
        durationMs: run.startedAtMs ? endedAtMs - run.startedAtMs : undefined,
      };
      saveBrowserRecipeRun(recovered);
      this.addEvent(run.id, 'run.completed', { status: recovered.status, error: recovered.error });
    }
  }

  list() { return listBrowserRecipes(); }
  get(id: string) { return getBrowserRecipe(id); }
  listRuns(recipeId?: string) { return listBrowserRecipeRuns(recipeId); }
  getRun(id: string) { return getBrowserRecipeRun(id); }
  listRunEvents(id: string) { return listBrowserRecipeRunEvents(id); }

  validate(yaml: string) { return validateBrowserPipeline(yaml, this.registry); }

  save(input: { yaml: string; status?: BrowserRecipeStatus; expectedId?: string }): BrowserRecipe {
    const validation = this.validate(input.yaml);
    if (!validation.ok || !validation.document) throw new Error(validation.errors.map((error) => `${error.path}: ${error.message}`).join('\n'));
    const document = validation.document;
    if (input.expectedId && document.id !== input.expectedId) throw new Error('Recipe id cannot change');
    const existing = getBrowserRecipe(document.id);
    const now = Date.now();
    const recipe: BrowserRecipe = {
      id: document.id,
      revision: (existing?.revision ?? 0) + 1,
      name: document.name,
      description: document.description,
      status: input.status ?? existing?.status ?? 'published',
      yaml: input.yaml,
      risk: document.risk,
      domains: document.domains,
      createdAtMs: existing?.createdAtMs ?? now,
      updatedAtMs: now,
    };
    saveBrowserRecipe(recipe);
    return recipe;
  }

  remove(id: string) {
    if (hasActiveBrowserRecipeRuns(id)) {
      throw new Error('Cannot delete a browser automation while it is running');
    }
    return deleteBrowserRecipe(id);
  }

  startRun(recipeId: string, args: Record<string, unknown>): BrowserRecipeRun {
    const recipe = getBrowserRecipe(recipeId);
    if (!recipe) throw new Error('Browser automation not found');
    if (recipe.status !== 'published') throw new Error('Only enabled browser automations can run');
    if (!this.validate(recipe.yaml).ok) throw new Error('Browser automation is invalid');
    const run: BrowserRecipeRun = { id: randomUUID(), recipeId, recipeRevision: recipe.revision, recipeYaml: recipe.yaml, status: 'queued', args, createdAtMs: Date.now() };
    saveBrowserRecipeRun(run);
    this.addEvent(run.id, 'run.queued', { recipeId });
    const execution = this.execute(run);
    this.executions.set(run.id, execution);
    void execution.finally(() => this.executions.delete(run.id)).catch(() => undefined);
    return run;
  }

  cancel(runId: string): boolean {
    const controller = this.activeRuns.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  async shutdown(): Promise<void> {
    for (const controller of this.activeRuns.values()) controller.abort();
    await Promise.allSettled(this.executions.values());
  }

  async runAndWait(recipeId: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<BrowserRecipeRun> {
    const run = this.startRun(recipeId, args);
    return new Promise((resolve) => {
      const onAbort = () => this.cancel(run.id);
      const complete = (completed: BrowserRecipeRun) => {
        signal?.removeEventListener('abort', onAbort);
        const active = this.runWaiters.get(run.id);
        active?.delete(complete);
        if (active?.size === 0) this.runWaiters.delete(run.id);
        resolve(completed);
      };
      const waiters = this.runWaiters.get(run.id) ?? new Set();
      waiters.add(complete);
      this.runWaiters.set(run.id, waiters);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      const current = this.getRun(run.id);
      if (current && current.status !== 'queued' && current.status !== 'running') complete(current);
    });
  }

  private addEvent(runId: string, type: string, data?: unknown): void {
    const seq = nextBrowserRecipeRunEventSeq(runId);
    const event = { id: randomUUID(), runId, seq, type, data, createdAtMs: Date.now() };
    appendBrowserRecipeRunEvent(event);
    this.emit?.(`browser.recipe.${type}`, event);
  }

  private async execute(run: BrowserRecipeRun): Promise<void> {
    const controller = new AbortController();
    this.activeRuns.set(run.id, controller);
    const startedAtMs = Date.now();
    let current: BrowserRecipeRun = { ...run, status: 'running', startedAtMs };
    saveBrowserRecipeRun(current);
    this.addEvent(run.id, 'run.started');
    try {
      const result = await this.executeRecipe({ yaml: run.recipeYaml, args: run.args, signal: controller.signal, onStep: (event) => this.addEvent(run.id, `step.${event.status}`, event) });
      const endedAtMs = Date.now();
      current = { ...current, status: controller.signal.aborted ? 'cancelled' : result.ok ? 'succeeded' : 'failed', result: result.data, error: result.error?.message, endedAtMs, durationMs: endedAtMs - startedAtMs };
    } catch (error) {
      const endedAtMs = Date.now();
      current = { ...current, status: controller.signal.aborted ? 'cancelled' : 'failed', error: error instanceof Error ? error.message : String(error), endedAtMs, durationMs: endedAtMs - startedAtMs };
    } finally {
      saveBrowserRecipeRun(current);
      this.addEvent(run.id, 'run.completed', { status: current.status, error: current.error });
      this.activeRuns.delete(run.id);
      for (const resolve of this.runWaiters.get(run.id) ?? []) resolve(current);
      this.runWaiters.delete(run.id);
    }
  }
}
