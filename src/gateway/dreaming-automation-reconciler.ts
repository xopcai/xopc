import type { Config } from '../config/schema.js';
import type { DreamingAgentScope } from '../agent/memory/dreaming/scope.js';
import type { DreamingResolvedConfig } from '../agent/memory/dreaming/config.js';
import { resolveDreamingAgentScope } from '../agent/memory/dreaming/scope.js';
import {
  DREAMING_AUTOMATION_TAG,
  DREAMING_DEEP_AUTOMATION_NAME,
  DREAMING_LIGHT_AUTOMATION_NAME,
  DREAMING_LIGHT_SWEEP_TOKEN,
  DREAMING_REM_AUTOMATION_NAME,
  DREAMING_REM_SWEEP_TOKEN,
  DREAMING_SWEEP_TOKEN,
  type DreamingPhaseId,
} from '../agent/memory/dreaming/constants.js';
import { compileDreamingSchedule } from '../agent/memory/dreaming/schedule.js';
import type { AutomationService } from '../automations/index.js';
import type { Automation, AutomationAction, AutomationTrigger } from '../automations/domain/types.js';

type DreamingAutomationSpec = {
  phase: DreamingPhaseId;
  name: string;
  token: string;
};

const DREAMING_AUTOMATIONS: readonly DreamingAutomationSpec[] = [
  {
    phase: 'light',
    name: DREAMING_LIGHT_AUTOMATION_NAME,
    token: DREAMING_LIGHT_SWEEP_TOKEN,
  },
  {
    phase: 'deep',
    name: DREAMING_DEEP_AUTOMATION_NAME,
    token: DREAMING_SWEEP_TOKEN,
  },
  {
    phase: 'rem',
    name: DREAMING_REM_AUTOMATION_NAME,
    token: DREAMING_REM_SWEEP_TOKEN,
  },
];

export type DreamingAutomationReconcileResult = {
  created: string[];
  updated: string[];
  disabled: string[];
};

function phaseDescription(phase: DreamingPhaseId): string {
  const label = phase === 'light' ? 'Light sweep' : phase === 'deep' ? 'Deep promotion' : 'REM pattern discovery';
  return `${label} for memory dreaming. ${DREAMING_AUTOMATION_TAG}`;
}

function buildTrigger(config: DreamingResolvedConfig, phase: DreamingPhaseId): AutomationTrigger {
  const phaseConfig = config.phases[phase];
  return {
    kind: 'schedule',
    schedule: {
      kind: 'cron',
      expr: compileDreamingSchedule(phaseConfig.schedule),
      tz: config.timezone,
    },
  };
}

function dreamingAutomationId(phase: DreamingPhaseId): string {
  return `system-user-context-dreaming:${phase}`;
}

function buildAction(scope: DreamingAgentScope, token: string): AutomationAction {
  return {
    kind: 'agent',
    agentId: scope.agentId,
    instruction: token,
    workingDirectory: scope.workspaceDir,
    timeoutSeconds: 3600,
  };
}

function automationNeedsUpdate(current: Automation, next: {
  name: string;
  description: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  action: AutomationAction;
}): boolean {
  return (
    current.name !== next.name ||
    current.description !== next.description ||
    current.enabled !== next.enabled ||
    JSON.stringify(current.trigger) !== JSON.stringify(next.trigger) ||
    JSON.stringify(current.action) !== JSON.stringify(next.action) ||
    current.safety?.mode !== 'auto_apply' ||
    current.afterRun?.kind !== 'none' ||
    current.reliability?.disableAfterConsecutiveFailures !== 3
  );
}

export async function reconcileDreamingAutomations(params: {
  config: Config;
  automationService: AutomationService;
}): Promise<DreamingAutomationReconcileResult> {
  const { config, automationService } = params;
  const result: DreamingAutomationReconcileResult = { created: [], updated: [], disabled: [] };

  const scope = resolveDreamingAgentScope(config);
  const resolved = scope.config;

  for (const spec of DREAMING_AUTOMATIONS) {
    const id = dreamingAutomationId(spec.phase);
    const current = await automationService.get(id);
    const enabled = resolved.enabled && resolved.phases[spec.phase].enabled;

    if (!resolved.enabled) {
      if (current?.enabled) {
        await automationService.update(id, { enabled: false });
        result.disabled.push(id);
      }
      continue;
    }

    const next = {
      name: spec.name,
      description: phaseDescription(spec.phase),
      enabled,
      trigger: buildTrigger(resolved, spec.phase),
      action: buildAction(scope, spec.token),
    };

    if (!current) {
      await automationService.create({
        id,
        ...next,
        safety: { mode: 'auto_apply' },
        afterRun: { kind: 'none' },
        reliability: { disableAfterConsecutiveFailures: 3 },
      });
      result.created.push(id);
      continue;
    }

    if (automationNeedsUpdate(current, next)) {
      await automationService.update(id, {
        ...next,
        safety: { mode: 'auto_apply' },
        afterRun: { kind: 'none' },
        reliability: { disableAfterConsecutiveFailures: 3 },
      });
      result.updated.push(id);
    }
  }

  return result;
}
