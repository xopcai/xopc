import { TaskCreateRequestSchema } from '@xopcai/gateway-contract';

import type { Automation, AutomationAction, AutomationNotificationPolicy, AutomationSchedule } from '../automations/domain/types.js';
import type { CreateAutomationInput } from '../automations/domain/validation.js';
import { TaskApplicationService } from '../tasks/task-application-service.js';
import { getPersonalAgent, type PersonalAgentRecord } from './repository.js';

type PersonalTaskAction = Extract<AutomationAction, { kind: 'personal_task' }>;

export function personalScheduleInput(
  profile: Pick<PersonalAgentRecord, 'agentId' | 'conversationId'>,
  input: Pick<CreateAutomationInput, 'id' | 'name' | 'description' | 'enabled'> & {
    instruction: string; locale: PersonalTaskAction['locale']; schedule: AutomationSchedule;
    notificationPolicy?: AutomationNotificationPolicy;
  },
): CreateAutomationInput {
  const { instruction, locale, schedule, notificationPolicy = 'attention', ...fields } = input;
  return { ...fields,
    trigger: { kind: 'schedule', schedule },
    action: { kind: 'personal_task', agentId: profile.agentId, conversationId: profile.conversationId, instruction, locale },
    management: { owner: 'personal-agent', editable: ['enabled', 'trigger'], runnable: true, deletable: true },
    conversationMode: 'new_session',
    delivery: { notificationPolicy, destinations: [{ key: 'gateway_event', kind: 'gateway_event' }] },
  };
}

export function isPersonalSchedule(automation: Automation | null, conversationId: string, agentId: string): automation is Automation & { action: PersonalTaskAction } {
  return automation?.action.kind === 'personal_task' && automation.action.conversationId === conversationId && automation.action.agentId === agentId;
}

export function startScheduledPersonalTask(title: string, action: PersonalTaskAction, runId: string): string {
  const profile = getPersonalAgent('local-owner');
  if (profile?.state !== 'ready' || profile.conversationId !== action.conversationId || profile.agentId !== action.agentId) {
    throw new Error('The Personal Agent for this schedule is unavailable');
  }
  const result = new TaskApplicationService().create(TaskCreateRequestSchema.parse({
    idempotencyKey: `personal-schedule:${runId}`,
    title,
    body: action.instruction,
    originConversationId: action.conversationId,
    locale: action.locale,
    contract: { objective: action.instruction.slice(0, 4000), expectedOutputs: [], acceptanceCriteria: [], constraints: [],
      approvalRequired: [], assumptions: [], risks: [], outputDestinations: [] },
    activation: { mode: 'start', executor: { kind: 'agent', agentId: action.agentId } },
  }), { kind: 'system', id: 'personal-schedule' }, { linkRunningOriginInput: false });
  if (result.ok === false) throw new Error(result.reason);
  return result.model.task.id;
}
