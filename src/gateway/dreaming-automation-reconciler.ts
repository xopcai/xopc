import type { Config } from '../config/schema.js';
import { normalizeAgentId } from '../agent/agent-scope.js';
import { resolveDreamingConfig, type DreamingResolvedConfig } from '../agent/memory/dreaming/config.js';
import { resolveDreamingAgentScope } from '../agent/memory/dreaming/scope.js';
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
  removed: string[];
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

function dreamingAutomationId(agentId: string, phase: DreamingPhaseId): string {
  return `system-dreaming:${normalizeAgentId(agentId)}:${phase}`;
}

function buildAction(config: Config, agentId: string, token: string): AutomationAction {
  const scope = resolveDreamingAgentScope(config, agentId);
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
  const result: DreamingAutomationReconcileResult = { created: [], updated: [], disabled: [], removed: [] };

  for (const spec of DREAMING_AUTOMATIONS) {
    if (await automationService.remove(spec.id)) {
      result.removed.push(spec.id);
    }
  }

  const expectedIds = new Set<string>();
  const agents = config.agents.list.filter((agent) => agent.enabled !== false);

  for (const agent of agents) {
    const agentId = normalizeAgentId(agent.id);
    const resolved = resolveDreamingConfig(config, agentId);

    for (const spec of DREAMING_AUTOMATIONS) {
      const id = dreamingAutomationId(agentId, spec.phase);
      expectedIds.add(id);
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
        name: `${spec.name} (${agentId})`,
        description: phaseDescription(spec.phase),
        enabled,
        trigger: buildTrigger(resolved, spec.phase),
        action: buildAction(config, agentId, spec.token),
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
  }

  const allAutomations = await automationService.list();
  for (const automation of allAutomations) {
    if (!automation.id.startsWith('system-dreaming:')) {
      continue;
    }
    if (expectedIds.has(automation.id)) {
      continue;
    }
    if (automation.enabled) {
      await automationService.update(automation.id, { enabled: false });
      result.disabled.push(automation.id);
    }
  }

  return result;
}
