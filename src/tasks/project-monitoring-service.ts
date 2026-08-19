import type {
  MonitoringMode,
  ProjectMonitoringPolicy,
  QuietHours,
} from '@xopcai/gateway-contract';

import { ProactiveScenarioService } from '../proactive/scenarios/service.js';
import {
  getSqliteDatabase,
  runSqliteWriteTransaction,
} from '../storage/sqlite/transaction.js';

export type ProactiveDisposition = 'record_silently' | 'show_in_work' | 'request_approval' | 'auto_execute';

type PolicyRow = {
  project_id: string;
  mode: MonitoringMode;
  quiet_hours_json: string | null;
  allowed_actions_json: string;
  confidence_threshold: number;
  updated_at: number;
};

const DEFAULT_SCENARIOS = ['project_delivery_risk', 'blocked_work'];

function validHour(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 23;
}

function rowToPolicy(row: PolicyRow, scenarios: string[]): ProjectMonitoringPolicy {
  return {
    projectId: row.project_id,
    mode: row.mode,
    quietHours: row.quiet_hours_json ? JSON.parse(row.quiet_hours_json) as QuietHours : undefined,
    allowedActions: JSON.parse(row.allowed_actions_json) as string[],
    confidenceThreshold: row.confidence_threshold,
    scenarios,
    configured: true,
    updatedAt: row.updated_at,
  };
}

export function decideProactiveDisposition(
  policy: ProjectMonitoringPolicy,
  input: { confidence: number; valueScore: number; risk: 'low' | 'medium' | 'high'; actionId?: string; requiresApproval?: boolean },
): ProactiveDisposition {
  if (policy.mode === 'observe' || input.confidence < policy.confidenceThreshold || input.valueScore < 0.5) {
    return 'record_silently';
  }
  if (input.requiresApproval || input.risk !== 'low') return 'request_approval';
  if (policy.mode === 'auto_low_risk' && input.actionId && policy.allowedActions.includes(input.actionId)) {
    return 'auto_execute';
  }
  return 'show_in_work';
}

export class ProjectMonitoringService {
  readonly #scenarios = new ProactiveScenarioService();

  get(projectId: string): ProjectMonitoringPolicy {
    const row = getSqliteDatabase()
      .prepare('SELECT * FROM project_monitoring_policies WHERE project_id = ?')
      .get(projectId) as PolicyRow | undefined;
    const scenarios = this.#scenarios.subscriptions()
      .filter((item) => item.scopeKind === 'project' && item.scopeId === projectId && item.enabled)
      .map((item) => item.scenarioKey)
      .sort();
    return row
      ? rowToPolicy(row, scenarios)
      : {
          projectId,
          mode: 'observe',
          allowedActions: [],
          confidenceThreshold: 0.75,
          scenarios: [],
          configured: false,
        };
  }

  configure(input: {
    projectId: string;
    mode: MonitoringMode;
    quietHours?: QuietHours;
    allowedActions?: string[];
    confidenceThreshold?: number;
    scenarios?: string[];
  }): ProjectMonitoringPolicy {
    const projectExists = getSqliteDatabase()
      .prepare('SELECT 1 FROM projects WHERE project_id = ?')
      .get(input.projectId);
    if (!projectExists) throw new Error('Project not found');
    if (input.quietHours && (
      !validHour(input.quietHours.startHour)
      || !validHour(input.quietHours.endHour)
      || !input.quietHours.timezone.trim()
    )) {
      throw new Error('Quiet hours need a timezone and integer hours from 0 through 23');
    }
    const threshold = input.confidenceThreshold ?? 0.75;
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new Error('confidenceThreshold must be between 0 and 1');
    }
    const allowedActions = [...new Set(input.allowedActions ?? [])]
      .map((action) => action.trim())
      .filter(Boolean);
    const scenarios = [...new Set(input.scenarios ?? DEFAULT_SCENARIOS)];
    const availableScenarios = new Set(this.#scenarios.list().map((scenario) => scenario.key));
    if (scenarios.some((scenario) => !availableScenarios.has(scenario))) throw new Error('Unknown proactive scenario');
    const existingSubscriptions = new Set(this.#scenarios.subscriptions()
      .filter((item) => item.scopeKind === 'project' && item.scopeId === input.projectId)
      .map((item) => item.scenarioKey));
    const now = Date.now();
    runSqliteWriteTransaction((db) => {
      db.prepare(
        `INSERT INTO project_monitoring_policies (
          project_id, mode, quiet_hours_json, allowed_actions_json, confidence_threshold, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET mode = excluded.mode,
          quiet_hours_json = excluded.quiet_hours_json,
          allowed_actions_json = excluded.allowed_actions_json,
          confidence_threshold = excluded.confidence_threshold,
          updated_at = excluded.updated_at`,
      ).run(
        input.projectId,
        input.mode,
        input.quietHours ? JSON.stringify(input.quietHours) : null,
        JSON.stringify(allowedActions),
        threshold,
        now,
        now,
      );
      const selected = new Set(scenarios);
      for (const scenario of availableScenarios) {
        if (!selected.has(scenario) && !existingSubscriptions.has(scenario)) continue;
        this.#scenarios.subscribe({
          scenarioKey: scenario,
          workspaceId: 'default',
          scopeKind: 'project',
          scopeId: input.projectId,
          enabled: selected.has(scenario),
        });
      }
    });
    return this.get(input.projectId);
  }
}
