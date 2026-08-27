import type { Config } from '../config/schema.js';
import { normalizeAgentId, resolveAgentWorkspaceDir, resolveDefaultAgentId } from '../agent/agent-scope.js';
import {
  compileContextConsolidationCron,
  resolveContextConsolidationConfig,
  USER_CONTEXT_CONSOLIDATION_AUTOMATION_ID,
  USER_CONTEXT_CONSOLIDATION_TOKEN,
} from '../user-context/consolidation.js';
import type { AutomationService } from '../automations/index.js';
import type { AutomationAction, AutomationTrigger } from '../automations/domain/types.js';

export type DreamingAutomationReconcileResult = {
  created: boolean;
  updated: boolean;
  disabled: boolean;
};

export async function reconcileDreamingAutomations(params: {
  config: Config;
  automationService: AutomationService;
}): Promise<DreamingAutomationReconcileResult> {
  const result: DreamingAutomationReconcileResult = {
    created: false, updated: false, disabled: false,
  };

  const resolved = resolveContextConsolidationConfig(params.config);
  const agentId = normalizeAgentId(resolveDefaultAgentId(params.config));
  const workingDirectory = resolveAgentWorkspaceDir(params.config, agentId);
  const trigger: AutomationTrigger = {
    kind: 'schedule',
    schedule: {
      kind: 'cron',
      expr: compileContextConsolidationCron(resolved.time),
      tz: resolved.timezone,
    },
  };
  const action: AutomationAction = {
    kind: 'agent', agentId, instruction: USER_CONTEXT_CONSOLIDATION_TOKEN,
    workingDirectory, timeoutSeconds: 300,
  };
  const current = await params.automationService.get(USER_CONTEXT_CONSOLIDATION_AUTOMATION_ID);
  if (!resolved.enabled) {
    if (current?.enabled) {
      await params.automationService.update(USER_CONTEXT_CONSOLIDATION_AUTOMATION_ID, { enabled: false });
      result.disabled = true;
    }
    return result;
  }
  const next = {
    name: 'User context review',
    description: 'Deterministically review structured user understanding for expiry and sufficient evidence.',
    enabled: true,
    trigger,
    action,
    safety: { mode: 'auto_apply' as const },
    conversationMode: 'continuous' as const,
    notificationPolicy: 'none' as const,
    reliability: { disableAfterConsecutiveFailures: 3 },
  };
  if (!current) {
    await params.automationService.create({ id: USER_CONTEXT_CONSOLIDATION_AUTOMATION_ID, ...next });
    result.created = true;
    return result;
  }
  const needsUpdate = current.name !== next.name
    || current.description !== next.description
    || !current.enabled
    || JSON.stringify(current.trigger) !== JSON.stringify(trigger)
    || JSON.stringify(current.action) !== JSON.stringify(action)
    || current.safety?.mode !== 'auto_apply'
    || current.conversationMode !== 'continuous'
    || current.notificationPolicy !== 'none'
    || current.reliability?.disableAfterConsecutiveFailures !== 3;
  if (needsUpdate) {
    await params.automationService.update(USER_CONTEXT_CONSOLIDATION_AUTOMATION_ID, next);
    result.updated = true;
  }
  return result;
}
