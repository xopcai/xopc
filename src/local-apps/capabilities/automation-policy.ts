import { createHash } from 'node:crypto';
import type { LocalAppResourceScopes } from '@xopcai/gateway-contract';

import type { Automation } from '../../automations/domain/types.js';
import { getAutomation, getAutomationRun } from '../../automations/storage/index.js';
import { canonicalCapabilityJson } from '../../capabilities/runtime/dispatcher.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';

/** Runtime state changes do not widen execution authority; definition changes require fresh review. */
export function automationConfigurationDigest(automation: Automation): string {
  const { state: _state, updatedAtMs: _updatedAtMs, ...definition } = automation;
  return createHash('sha256').update(canonicalCapabilityJson(JSON.parse(JSON.stringify(definition)))).digest('hex');
}

export function automationReadable(scopes: LocalAppResourceScopes, automation: Automation): boolean {
  const scope = scopes.automationsRead;
  return scope.mode === 'workspace' || scope.mode === 'selected'
    && (scope.ids.includes(automation.id) || Boolean(automation.projectId && scope.projectIds.includes(automation.projectId)));
}

export function automationRunApproved(scopes: LocalAppResourceScopes, automation: Automation): boolean {
  const scope = scopes.automationsRun;
  return scope.mode === 'selected' && automation.enabled && automation.action.kind === 'agent'
    && (!automation.management || automation.management.runnable)
    && scope.approvals.some(item => item.id === automation.id && item.configurationDigest === automationConfigurationDigest(automation)
      && item.authority.expiresAt > Date.now() && item.authority.maxRuns > 0 && item.authority.model
      && automation.delivery.destinations.every(destination => destination.kind === 'gateway_event' ? true
        : destination.kind === 'file' ? item.authority.dataWrite : item.authority.externalSend));
}

export function localAppAutomationAllowed(extensionId: string, scopes: LocalAppResourceScopes, capability: string, input: unknown): boolean {
  if (['xopc.automations.propose', 'xopc.automations.get_proposal', 'xopc.automations.simulate'].includes(capability)) return scopes.automationProposals;
  const id = (input as { id?: string })?.id;
  if (capability === 'xopc.automations.list' || capability === 'xopc.automations.history') return scopes.automationsRead.mode !== 'none';
  if (!id) return false;
  if (capability === 'xopc.automations.get' || capability === 'xopc.automations.run') {
    const automation = getAutomation(id);
    return Boolean(automation && (capability === 'xopc.automations.get'
      ? automationReadable(scopes, automation) : automationRunApproved(scopes, automation)));
  }
  // Apps may inspect or cancel only runs that this app actually submitted, never arbitrary historical runs.
  if (!['xopc.automations.get_run', 'xopc.automations.cancel', 'xopc.automations.run_events'].includes(capability)) return false;
  const owner = new DurableState<{ automationId: string }>('local-app-automation-runs', extensionId).get(id);
  const run = owner && getAutomationRun(id);
  const automation = run && getAutomation(run.automationId);
  if (!owner || !run || owner.automationId !== run.automationId || !automation) return false;
  return capability === 'xopc.automations.cancel'
    ? scopes.automationsRun.mode === 'selected' && scopes.automationsRun.approvals.some(item => item.id === automation.id)
    : automationReadable(scopes, automation);
}
