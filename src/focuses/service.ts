import type { Automation, AutomationRun } from '../automations/index.js';
import { createLogger } from '../utils/logger.js';

import {
  createFocus,
  createFocusActivity,
  deleteFocus,
  getFocus,
  getFocusMonitor,
  listAllFocusMonitors,
  listFocusMonitors,
  listFocuses,
  updateFocus,
  updateFocusMonitorRuntime,
  upsertFocusMonitor,
} from './repository.js';
import { buildFocusMonitorInstruction } from './prompts.js';
import type {
  Focus,
  FocusCadence,
  FocusDetail,
  FocusMonitor,
  FocusMonitorKind,
  FocusStatus,
} from './types.js';

const log = createLogger('FocusService');
const DEFAULT_CADENCE: FocusCadence = { kind: 'interval', everyMs: 86_400_000 };

export interface FocusAutomationPort {
  create(input: Parameters<import('../automations/index.js').AutomationService['create']>[0]): Promise<Automation>;
  get(id: string): Promise<Automation | null>;
  update(id: string, input: Parameters<import('../automations/index.js').AutomationService['update']>[1]): Promise<Automation>;
  pause(id: string): Promise<Automation>;
  resume(id: string): Promise<Automation>;
  remove(id: string): Promise<boolean>;
  runNow(id: string): Promise<AutomationRun>;
}

export class FocusService {
  constructor(private readonly automations: FocusAutomationPort) {}

  list(statuses?: FocusStatus[]): FocusDetail[] {
    return listFocuses({ statuses }).map((focus) => this.detail(focus));
  }

  get(id: string): FocusDetail | null {
    const focus = getFocus(id);
    return focus ? this.detail(focus) : null;
  }

  create(input: {
    title: string;
    summary: string;
    projectIds?: string[];
    goalId?: string;
  }): FocusDetail {
    if (!input.title.trim()) throw new Error('Focus title is required');
    const focus = createFocus(input);
    return this.detail(focus);
  }

  update(id: string, input: {
    title?: string;
    summary?: string;
    projectIds?: string[];
  }): FocusDetail | null {
    if (input.title !== undefined && !input.title.trim()) throw new Error('Focus title is required');
    const focus = updateFocus({ id, ...input });
    if (!focus) return null;
    createFocusActivity({ focusId: id, type: 'updated', summary: 'Focus updated' });
    return this.get(id);
  }

  async setStatus(id: string, status: FocusStatus): Promise<FocusDetail | null> {
    const focus = getFocus(id);
    if (!focus) return null;
    if (focus.status === status) return this.detail(focus);

    const monitors = listFocusMonitors(id);
    if (status === 'active') {
      for (const monitor of monitors.filter((item) => item.enabled && item.automationId)) {
        await this.automations.resume(monitor.automationId!);
      }
    } else if (status === 'paused') {
      for (const monitor of monitors.filter((item) => item.enabled && item.automationId)) {
        await this.automations.pause(monitor.automationId!);
      }
    } else {
      for (const monitor of monitors.filter((item) => item.automationId)) {
        await this.automations.remove(monitor.automationId!);
        upsertFocusMonitor({
          focusId: id,
          kind: monitor.kind,
          enabled: false,
          cadence: monitor.cadence,
          automationId: null,
        });
      }
    }

    const updated = updateFocus({ id, status });
    if (!updated) return null;
    const type = status === 'active' ? 'resumed' : status === 'paused' ? 'paused' : 'completed';
    createFocusActivity({ focusId: id, type, summary: `Focus ${type}` });
    return this.get(id);
  }

  async remove(id: string): Promise<boolean> {
    if (!getFocus(id)) return false;
    for (const monitor of listFocusMonitors(id).filter((item) => item.automationId)) {
      await this.automations.remove(monitor.automationId!);
    }
    return deleteFocus(id);
  }

  async configureMonitor(input: {
    focusId: string;
    kind: FocusMonitorKind;
    enabled: boolean;
    cadence?: FocusCadence;
  }): Promise<{ monitor: FocusMonitor; initialRunId?: string }> {
    const focus = getFocus(input.focusId);
    if (!focus) throw new Error('Focus not found');
    if (focus.status !== 'active') throw new Error('Only active focuses can enable monitoring');
    const existing = getFocusMonitor(input.focusId, input.kind);
    const cadence = input.cadence ?? existing?.cadence ?? DEFAULT_CADENCE;
    if (cadence.kind !== 'interval' || cadence.everyMs < 60_000) throw new Error('Invalid monitor cadence');

    if (input.enabled && existing?.enabled && existing.cadence.everyMs === cadence.everyMs) {
      return { monitor: existing };
    }

    if (!input.enabled) {
      if (existing?.automationId) await this.automations.pause(existing.automationId);
      const monitor = upsertFocusMonitor({
        focusId: input.focusId,
        kind: input.kind,
        enabled: false,
        cadence,
        automationId: existing?.automationId,
      });
      createFocusActivity({
        focusId: input.focusId,
        monitorId: monitor.id,
        type: 'monitor_disabled',
        summary: `${input.kind} monitoring disabled`,
      });
      return { monitor };
    }

    let monitor = upsertFocusMonitor({
      focusId: input.focusId,
      kind: input.kind,
      enabled: true,
      runState: 'queued',
      cadence,
      automationId: existing?.automationId,
    });

    try {
      let automation: Automation;
      if (existing?.automationId) {
        if (existing.cadence.everyMs !== cadence.everyMs) {
          automation = await this.automations.update(existing.automationId, {
            trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMs: cadence.everyMs } },
          });
        } else {
          automation = await this.automations.resume(existing.automationId);
        }
      } else {
        automation = await this.automations.create({
          name: `Monitor: ${focus.title}`.slice(0, 200),
          description: `${input.kind} monitor for a user-confirmed focus.`,
          ...(focus.projectIds[0] ? { projectId: focus.projectIds[0] } : {}),
          trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMs: cadence.everyMs } },
          action: {
            kind: 'agent',
            instruction: buildFocusMonitorInstruction(focus, input.kind),
            timeoutSeconds: 300,
          },
          safety: { mode: 'suggest_only' },
          afterRun: { kind: 'none' },
          reliability: { timeoutSeconds: 300, disableAfterConsecutiveFailures: 3 },
        });
      }
      monitor = upsertFocusMonitor({
        focusId: input.focusId,
        kind: input.kind,
        enabled: true,
        runState: 'queued',
        cadence,
        automationId: automation.id,
      });
      createFocusActivity({
        focusId: input.focusId,
        monitorId: monitor.id,
        type: 'monitor_enabled',
        summary: `${input.kind} monitoring enabled`,
      });
      const run = await this.automations.runNow(automation.id);
      monitor = updateFocusMonitorRuntime({
        id: monitor.id,
        runState: 'running',
        lastRunId: run.id,
        nextRunAt: automation.state.nextRunAtMs ?? null,
      }) ?? monitor;
      createFocusActivity({
        focusId: input.focusId,
        monitorId: monitor.id,
        type: 'run_started',
        summary: 'Initial monitor check started',
        details: { runId: run.id },
      });
      return { monitor, initialRunId: run.id };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      updateFocusMonitorRuntime({ id: monitor.id, runState: 'failed', error: errorMessage });
      log.error({ err, focusId: input.focusId, monitorKind: input.kind }, `Focus monitor enable failed: ${errorMessage}`);
      throw err;
    }
  }

  async runMonitorNow(focusId: string, kind: FocusMonitorKind): Promise<AutomationRun> {
    const monitor = getFocusMonitor(focusId, kind);
    if (!monitor?.enabled || !monitor.automationId) throw new Error('Monitor is not enabled');
    updateFocusMonitorRuntime({ id: monitor.id, runState: 'queued', error: null });
    const run = await this.automations.runNow(monitor.automationId);
    updateFocusMonitorRuntime({ id: monitor.id, runState: 'running', lastRunId: run.id });
    createFocusActivity({
      focusId,
      monitorId: monitor.id,
      type: 'run_started',
      summary: 'Monitor check started',
      details: { runId: run.id },
    });
    return run;
  }

  async reconcile(): Promise<void> {
    for (const monitor of listAllFocusMonitors()) {
      const focus = getFocus(monitor.focusId);
      if (!focus) continue;
      const automation = monitor.automationId ? await this.automations.get(monitor.automationId) : null;
      if (monitor.enabled && focus.status === 'active' && !automation) {
        try {
          await this.configureMonitor({ focusId: focus.id, kind: monitor.kind, enabled: true, cadence: monitor.cadence });
        } catch (err) {
          log.warn({ err, focusId: focus.id, monitorId: monitor.id }, 'Focus monitor reconciliation failed');
        }
      } else if ((!monitor.enabled || focus.status !== 'active') && automation?.enabled) {
        await this.automations.pause(automation.id);
      }
    }
  }

  private detail(focus: Focus): FocusDetail {
    return { ...focus, monitors: listFocusMonitors(focus.id) };
  }
}
