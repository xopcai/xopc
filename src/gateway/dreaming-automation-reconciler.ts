import type { Config } from '../config/schema.js';
import { getWorkspacePath } from '../config/workspace-path-helpers.js';
import { resolveDefaultAgentId } from '../agent/agent-scope.js';
import { resolveDreamingConfig, type DreamingResolvedConfig } from '../agent/memory/dreaming/config.js';
import {
  DREAMING_CRON_NAME,
  DREAMING_CRON_TAG,
  DREAMING_LIGHT_CRON_NAME,
  DREAMING_LIGHT_SWEEP_TOKEN,
  DREAMING_REM_CRON_NAME,
  DREAMING_REM_SWEEP_TOKEN,
  DREAMING_SWEEP_TOKEN,
  type DreamingPhaseId,
} from '../agent/memory/dreaming/constants.js';
import type { AutomationService } from '../automations/index.js';
import type { Automation, AutomationAction, AutomationTrigger } from '../automations/domain/types.js';

type DreamingAutomationSpec = {
  id: string;
  phase: DreamingPhaseId;
  name: string;
  token: string;
};

const DREAMING_AUTOMATIONS: readonly DreamingAutomationSpec[] = [
  {
    id: 'system-dreaming-light',
    phase: 'light',
    name: DREAMING_LIGHT_CRON_NAME,
    token: DREAMING_LIGHT_SWEEP_TOKEN,
  },
  {
    id: 'system-dreaming-deep',
    phase: 'deep',
    name: DREAMING_CRON_NAME,
    token: DREAMING_SWEEP_TOKEN,
  },
  {
    id: 'system-dreaming-rem',
    phase: 'rem',
    name: DREAMING_REM_CRON_NAME,
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
  return `${label} for memory dreaming. ${DREAMING_CRON_TAG}`;
}

function buildTrigger(config: DreamingResolvedConfig, phase: DreamingPhaseId): AutomationTrigger {
  const phaseConfig = config.phases[phase];
  return {
    kind: 'schedule',
    schedule: {
      kind: 'cron',
      expr: phaseConfig.cron,
      ...(config.timezone ? { tz: config.timezone } : {}),
    },
  };
}

function buildAction(config: Config, agentId: string, token: string): AutomationAction {
  const workspaceDir = getWorkspacePath(config);
  return {
    kind: 'agent',
    agentId,
    instruction: token,
    ...(workspaceDir ? { workingDirectory: workspaceDir } : {}),
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
  const resolved = resolveDreamingConfig(config);
  const agentId = resolveDefaultAgentId(config);
  const result: DreamingAutomationReconcileResult = { created: [], updated: [], disabled: [] };

  for (const spec of DREAMING_AUTOMATIONS) {
    const current = await automationService.get(spec.id);
    const enabled = resolved.enabled && resolved.phases[spec.phase].enabled;

    if (!resolved.enabled) {
      if (current?.enabled) {
        await automationService.update(spec.id, { enabled: false });
        result.disabled.push(spec.id);
      }
      continue;
    }

    const next = {
      name: spec.name,
      description: phaseDescription(spec.phase),
      enabled,
      trigger: buildTrigger(resolved, spec.phase),
      action: buildAction(config, agentId, spec.token),
    };

    if (!current) {
      await automationService.create({
        id: spec.id,
        ...next,
        safety: { mode: 'auto_apply' },
        afterRun: { kind: 'none' },
        reliability: { disableAfterConsecutiveFailures: 3 },
      });
      result.created.push(spec.id);
      continue;
    }

    if (automationNeedsUpdate(current, next)) {
      await automationService.update(spec.id, {
        ...next,
        safety: { mode: 'auto_apply' },
        afterRun: { kind: 'none' },
        reliability: { disableAfterConsecutiveFailures: 3 },
      });
      result.updated.push(spec.id);
    }
  }

  return result;
}
