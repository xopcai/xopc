import { randomUUID } from 'node:crypto';

import type { CreateAutomationInput, UpdateAutomationInput } from '../domain/validation.js';
import { CreateAutomationSchema, UpdateAutomationSchema } from '../domain/validation.js';
import type { AutomationRepairDraftResponse, AutomationSimulation } from './automation-draft.types.js';

interface GeneratedAutomationDraft {
  automation: CreateAutomationInput;
  explanation: string;
  assumptions: string[];
  risks: string[];
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error('Model output did not contain a JSON object');
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

export function parseGeneratedAutomationDraft(raw: string): GeneratedAutomationDraft {
  const json = extractJsonObject(raw);
  const parsed = JSON.parse(json) as { automation?: unknown; explanation?: unknown; assumptions?: unknown; risks?: unknown };
  const automation = CreateAutomationSchema.parse(parsed.automation) as CreateAutomationInput;
  return {
    automation,
    explanation: String(parsed.explanation ?? ''),
    assumptions: stringArray(parsed.assumptions),
    risks: stringArray(parsed.risks),
  };
}

export function buildAutomationDraftResponse(
  draft: GeneratedAutomationDraft,
  repairAttempts: number,
) {
  return {
    draftId: randomUUID(),
    automation: draft.automation,
    explanation: draft.explanation,
    assumptions: draft.assumptions,
    risks: draft.risks,
    simulation: simulateAutomation(draft.automation),
    repairAttempts,
  };
}

export function parseGeneratedAutomationRepairDraft(
  raw: string,
  repairAttempts: number,
): AutomationRepairDraftResponse {
  const json = extractJsonObject(raw);
  const parsed = JSON.parse(json) as {
    patch?: unknown;
    explanation?: unknown;
    expectedEffect?: unknown;
    risks?: unknown;
    requiresApproval?: unknown;
  };
  const patch = UpdateAutomationSchema.parse(parsed.patch) as UpdateAutomationInput;
  return {
    draftId: randomUUID(),
    patch,
    explanation: String(parsed.explanation ?? ''),
    expectedEffect: String(parsed.expectedEffect ?? ''),
    risks: stringArray(parsed.risks),
    requiresApproval: parsed.requiresApproval !== false || repairPatchNeedsApproval(patch),
    repairAttempts,
  };
}

export function simulateAutomation(input: CreateAutomationInput): AutomationSimulation {
  const automation = CreateAutomationSchema.parse(input) as CreateAutomationInput;
  const safetyNotes: string[] = [];
  const requiredConfirmations: string[] = [];

  const triggerSummary = summarizeTrigger(automation.trigger);
  const actionSummary = summarizeAction(automation.action);

  if (automation.action.kind === 'agent' && /delete|remove|send|post|publish|付款|删除|发送|发布/i.test(automation.action.instruction)) {
    requiredConfirmations.push('Agent instruction may perform an external or destructive action.');
  }
  if (automation.afterRun?.kind === 'webhook') {
    safetyNotes.push('After-run webhook will call an external URL after each run.');
    requiredConfirmations.push('External webhook call should be reviewed before publishing.');
  }
  const safetyMode = automation.safety?.mode ?? 'auto_apply';
  if (safetyMode === 'suggest_only') {
    safetyNotes.push('Suggest-only safety mode will generate recommendations without applying changes.');
  } else if (safetyMode === 'ask_before_apply') {
    safetyNotes.push('Ask-before-applying safety mode requires confirmation before applying changes.');
  } else {
    safetyNotes.push('Auto-apply safety mode may act automatically when the trigger matches.');
    requiredConfirmations.push('Auto-apply mode should only be used for trusted automations.');
  }
  if (automation.trigger.kind === 'webhook') {
    safetyNotes.push('Webhook trigger can be invoked externally; keep its secret id private.');
  }
  if (automation.trigger.kind === 'event') {
    safetyNotes.push('Product-event trigger runs automatically when matching xopc events are published.');
  }

  return {
    triggerSummary,
    actionSummary,
    safetyNotes,
    requiredConfirmations,
    canRunNow: automation.trigger.kind === 'manual',
    runNowBlockedReason: automation.trigger.kind === 'manual' ? undefined : 'Only manual automations can be run immediately from the draft.',
  };
}

function summarizeTrigger(trigger: CreateAutomationInput['trigger']): string {
  if (trigger.kind === 'manual') return 'Runs only when started manually.';
  if (trigger.kind === 'webhook') return 'Runs when the automation webhook is called.';
  if (trigger.kind === 'event') {
    const source = trigger.source ? ` from ${trigger.source}` : '';
    return `Runs on product event ${trigger.eventType}${source}.`;
  }
  const schedule = trigger.schedule;
  if (schedule.kind === 'interval') return `Runs every ${Math.round(schedule.everyMs / 60000)} minutes.`;
  if (schedule.kind === 'once') return `Runs once at ${schedule.at}.`;
  return `Runs on cron schedule ${schedule.expr}.`;
}

function summarizeAction(action: CreateAutomationInput['action']): string {
  if (action.kind === 'workflow') return `Starts workflow ${action.workflowId}.`;
  if (action.kind === 'browser_recipe') return `Runs browser automation ${action.recipeId}.`;
  return action.agentId ? `Runs agent ${action.agentId}.` : 'Runs the default agent.';
}

function repairPatchNeedsApproval(patch: UpdateAutomationInput): boolean {
  if (patch.safety?.mode === 'auto_apply') return true;
  if (patch.afterRun?.kind === 'webhook') return true;
  if (patch.trigger?.kind === 'webhook') return true;
  if (patch.action?.kind === 'agent') {
    return /delete|remove|send|post|publish|付款|删除|发送|发布/i.test(patch.action.instruction);
  }
  return false;
}
