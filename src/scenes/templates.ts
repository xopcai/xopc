import { sceneTemplateSchema } from './contracts.js';

export const mailFollowUpTemplate = sceneTemplateSchema.parse({
  schemaVersion: 1, key: 'mail-follow-up', version: '1.0.0', title: '跟进重要邮件',
  description: '在约定时间检查指定邮件，准备需要你判断的下一步；不自动发送。',
  goalMode: 'ongoing', contextProviders: ['mail'],
  triggers: [{ id: 'check', type: 'manual' }, { id: 'due', type: 'schedule' }, { id: 'changed', type: 'event', eventType: 'mail.thread.changed' }],
  execution: {
    kind: 'agent',
    instruction: 'Review the authorized mail thread against the user goal. If a reply resolves the request or no useful next step exists, return no_change. Otherwise prepare a concise follow-up draft or a decision with evidence. Do not infer that a draft was sent. Do not infer missing messages or recipients.',
    limits: { timeoutSeconds: 90, maxIterations: 1, maxToolCalls: 0, maxOutputTokens: 2000 },
  },
  allowedOutcomeKinds: ['no_change', 'artifact', 'decision'], allowedEffectHandlers: [],
});

export const familyPlanTemplate = sceneTemplateSchema.parse({
  schemaVersion: 1, key: 'weekly-family-plan', version: '1.0.0', title: '提前准备下周家庭安排',
  description: '根据你提供的安排整理冲突、准备事项和可选计划，不替你决定家庭活动。',
  goalMode: 'ongoing', contextProviders: ['user_notes'],
  triggers: [{ id: 'check', type: 'manual' }, { id: 'weekly-review', type: 'schedule' }],
  execution: {
    kind: 'agent',
    instruction: 'Use only the supplied family arrangements to prepare next week. Surface concrete conflicts and useful preparations. Preserve room for rest and changing plans. Do not infer access to other family members, medical advice, or obligations not provided by the user. No useful change means no_change.',
    limits: { timeoutSeconds: 90, maxIterations: 1, maxToolCalls: 0, maxOutputTokens: 2000 },
  },
  allowedOutcomeKinds: ['no_change', 'artifact', 'decision'], allowedEffectHandlers: [],
});
