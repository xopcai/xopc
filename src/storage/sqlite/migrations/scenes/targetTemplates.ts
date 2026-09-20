import type { DatabaseSync } from 'node:sqlite';

import { sceneContentHash } from './targetContract.js';

// Immutable target templates for this data migration, not the runtime catalog.
/** An inert reference for preserved history whose original execution capabilities are not installed. */
export const historyOnlyTemplate = {
  schemaVersion: 1, key: 'imported-history', version: '1.0.0', title: '迁移前的场景历史',
  description: '保留原有委托和成果供查阅；请开启当前支持的场景继续工作。',
  goalMode: 'ongoing', availability: 'history_only', contextProviders: [],
  triggers: [{ id: 'check', type: 'manual' }],
  execution: { kind: 'agent', instruction: 'This history reference cannot execute.',
    limits: { timeoutSeconds: 1, maxIterations: 1, maxToolCalls: 0, maxOutputTokens: 1 } },
  allowedOutcomeKinds: ['no_change'], allowedEffectHandlers: [],
} as const;

export const mailFollowUpTemplate = {
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
} as const;


export function installMigratedTemplate(db: DatabaseSync, template: typeof historyOnlyTemplate | typeof mailFollowUpTemplate): void {
  const hash = sceneContentHash(template);
  const previous = db.prepare('SELECT content_hash FROM scene_template_versions WHERE template_key = ? AND version = ?')
    .get(template.key, template.version);
  if (previous && previous.content_hash !== hash) throw new Error('Migration template version differs from the stored version');
  db.prepare('INSERT OR IGNORE INTO scene_template_versions VALUES (?, ?, ?, ?)')
    .run(template.key, template.version, hash, JSON.stringify(template));
}
