import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import type { Config } from '../../config/schema.js';
import { getPersonalAgentByConversation } from '../../personal-agent/repository.js';
import { applyThreadFeedback, getAttention, getProactivitySettings, listAttention, listInterestCandidates, patchAttention, patchProactivitySettings, rollbackStrategy, saveAttention, strategyState, userText } from '../../personal-agent/proactivity/repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { readCurrentTranscriptId } from '../../storage/sqlite/session-instance-repository.js';
import { resolveUserContextSessionAccess } from '../../user-context/access-policy.js';
import { parseLocalCheckTime } from '../../personal-agent/proactivity/follow-up-request.js';

const schema = Type.Object({
  command: Type.Union([Type.Literal('list'), Type.Literal('follow'), Type.Literal('pause'), Type.Literal('end'), Type.Literal('resume'), Type.Literal('settings'), Type.Literal('interests'), Type.Literal('feedback'), Type.Literal('rollback')]),
  id: Type.Optional(Type.String()), subject: Type.Optional(Type.String({ maxLength: 160 })),
  summary: Type.Optional(Type.String({ maxLength: 1600 })), nextCheckAt: Type.Optional(Type.Number()),
  nextCheckLocal: Type.Optional(Type.String({ description: 'Preferred check time: YYYY-MM-DDTHH:mm in the user configured timezone. Use this instead of calculating epoch milliseconds. For vague tomorrow afternoon, use 15:00.' })),
  taskId: Type.Optional(Type.String()), projectId: Type.Optional(Type.String()),
  mode: Type.Optional(Type.Union([Type.Literal('off'), Type.Literal('follow_up'), Type.Literal('balanced')])),
  feedback: Type.Optional(Type.Union([Type.Literal('stop'), Type.Literal('defer'), Type.Literal('adjust')])),
  preparation: Type.Optional(Type.Union([Type.Literal('brief'), Type.Literal('thorough')])),
  versionId: Type.Optional(Type.String({ description: 'Latest strategy version ID returned by list; required for rollback.' })),
});

export function createPersonalAttentionTool(deps: {
  getConversationId: () => string | undefined; getConfig: () => Config | undefined;
}): AgentTool<typeof schema, Record<string, never>> {
  return { name: 'personal_attention', label: 'Personal follow-up',
    description: 'Persist or inspect attention in this personal conversation. An explicit request such as "check tomorrow afternoon and proactively tell me if useful" authorizes follow. The running Gateway automatically checks saved attention while the user is away and posts useful developments in this chat; no separate user automation is required. Prefer nextCheckLocal over epoch arithmetic. Checks are not guaranteed notifications. No action authorization is granted. Only claim saved after a successful result; an error means it was not saved, not that background checks are unsupported. Use pause/end/resume only for an explicit user instruction; do not duplicate an existing automation. Query list to verify whether follow-up is saved or active; query settings for current mode and timezone. Use current tool results rather than historical assistant claims. Valid commands: follow, list, settings, pause, end, resume, interests, feedback, rollback. interests reads silent candidates, not authorization. feedback saves an explicit topic preparation/stop/defer preference; rollback undoes the latest version on explicit request. Query list for IDs and versions. settings reads or explicitly changes off, follow_up, balanced.',
    parameters: schema,
    async execute(_toolId, input) {
      const conversationId = deps.getConversationId();
      const personal = conversationId ? getPersonalAgentByConversation(conversationId) : null;
      const config = deps.getConfig();
      if (!personal || !conversationId || !config) throw new Error('Personal attention is unavailable');
      if ((input.command === 'follow' || input.command === 'resume') && (!resolveUserContextSessionAccess(config, conversationId).userModel
        || config.userContext.userModel.writePolicy === 'deny')) throw new Error('Personal attention is unavailable');
      if (input.command === 'settings' && !input.mode) return { content: [{ type: 'text', text: JSON.stringify(getProactivitySettings(personal.ownerId)) }], details: {} };
      if (input.command === 'interests') {
        if (!resolveUserContextSessionAccess(config, conversationId).userModel) throw new Error('Interest access is unavailable');
        return { content: [{ type: 'text', text: JSON.stringify(listInterestCandidates(conversationId)) }], details: {} };
      }
      if (input.command === 'list') return { content: [{ type: 'text', text: JSON.stringify(listAttention(conversationId).map(thread => ({
        id: thread.id, subject: thread.subject, status: thread.status, nextCheckAt: thread.next_check_at, revision: thread.revision,
        strategy: strategyState(thread.id) }))) }], details: {} };
      const db = getSqliteDatabase();
      const transcriptId = readCurrentTranscriptId(db, conversationId);
      const source = db.prepare("SELECT entry_id,payload_json FROM transcript_entries WHERE transcript_id = ? AND role = 'user' ORDER BY seq DESC LIMIT 1")
        .get(transcriptId) as { entry_id: string; payload_json: string } | undefined;
      if (!source) throw new Error('An explicit user source is required');
      const sourceText = userText(JSON.parse(source.payload_json));
      const settings = getProactivitySettings(personal.ownerId);
      const nextCheckAt = input.nextCheckLocal ? parseLocalCheckTime(input.nextCheckLocal, settings.timezone) : input.nextCheckAt;
      if (input.command === 'settings') {
        const patterns = { off: /关闭.*主动|不要.*主动|别.*主动|停.*主动|disable|turn off|no.*proactive/iu,
          follow_up: /(?:仅|只|少|only|less).*(?:跟进|提醒|联系|follow|remind|contact)/iu,
          balanced: /(?:开启|恢复|允许|可以|更).*(?:主动|联系)|enable.*proactive|more proactive/iu };
        if (!input.mode || !patterns[input.mode].test(sourceText)) throw new Error('An explicit mode instruction is required');
        const settings = patchProactivitySettings(personal.ownerId, { ...getProactivitySettings(personal.ownerId), mode: input.mode });
        return { content: [{ type: 'text', text: JSON.stringify(settings) }], details: {} };
      }
      let thread;
      if (input.command === 'feedback' || input.command === 'rollback') {
        const current = input.id ? getAttention(input.id, personal.ownerId) : undefined;
        if (!current || current.conversation_id !== conversationId) throw new Error('Attention is unavailable');
        if (input.command === 'rollback') {
          if (!/撤销|撤回|回滚|恢复.*(?:之前|原来)|undo|roll\s?back/iu.test(sourceText) || !input.versionId) throw new Error('An explicit undo instruction and latest version ID are required');
          thread = rollbackStrategy(personal.ownerId, current.id, { versionId: input.versionId, revision: current.revision,
            idempotencyKey: `input:${source.entry_id}:${current.id}` }, source.entry_id);
        } else {
          const patterns = { stop: /停止|结束|别再|不用.*(?:关注|跟进|提醒)|stop|don't.*(?:follow|remind)/iu,
            defer: /晚点|明天|下周|再说|later|tomorrow|next week/iu,
            adjust: /(?:以后|今后|下次|future|always|next time).*(?:准备|完整|详细|简短|prepare|thorough|brief)|(?:准备|完整|详细|简短|prepare|thorough|brief).*(?:以后|今后|下次|future|always|next time)/iu };
          if (!input.feedback || !patterns[input.feedback].test(sourceText)) throw new Error('An explicit topic feedback instruction is required');
          thread = applyThreadFeedback(personal.ownerId, current.id, current.revision, {
            idempotencyKey: `input:${source.entry_id}:${current.id}`, kind: input.feedback, scope: 'thread',
            until: input.feedback === 'defer' ? nextCheckAt : undefined,
            preparation: input.feedback === 'adjust' ? input.preparation : undefined,
          }, { entryId: source.entry_id });
        }
      } else if (input.command === 'follow') {
        if (!input.subject) throw new Error('A subject is required');
        thread = saveAttention({ conversationId, subject: input.subject, summary: input.summary ?? input.subject,
          kind: 'outcome', entryIds: [source.entry_id], explicit: true, nextCheckAt: nextCheckAt ?? Date.now() + 86_400_000,
          taskId: input.taskId, projectId: input.projectId });
        if (thread.authority !== 'user_explicit') throw new Error('Follow-up must be explicitly requested');
      } else {
        const current = input.id ? getAttention(input.id, personal.ownerId) : undefined;
        if (!current || current.conversation_id !== conversationId) throw new Error('Attention is unavailable');
        const text = sourceText;
        const patterns = { pause: /暂停|晚点|再说|下周|明天|pause|later|next week/iu,
          end: /停止|结束|别再|不用.*(?:跟进|关注|提醒)|stop|end|don't.*(?:follow|remind)/iu,
          resume: /恢复|继续|重新|resume|continue/iu };
        if (!patterns[input.command].test(text)) throw new Error('An explicit instruction is required');
        thread = input.command === 'end' ? applyThreadFeedback(personal.ownerId, current.id, current.revision, {
          idempotencyKey: `input:${source.entry_id}:${current.id}`, kind: 'stop', scope: 'thread',
        }, { entryId: source.entry_id }) : patchAttention(personal.ownerId, current.id, current.revision, {
          status: input.command === 'pause' ? 'paused' : 'active',
          nextCheckAt,
        });
      }
      return { content: [{ type: 'text', text: JSON.stringify({ id: thread.id, status: thread.status,
        nextCheckAt: thread.next_check_at,
        strategy: strategyState(thread.id),
        timezone: settings.timezone,
        nextCheckLocal: thread.next_check_at === null ? null : new Intl.DateTimeFormat('sv-SE', { timeZone: settings.timezone, dateStyle: 'short', timeStyle: 'short' }).format(thread.next_check_at),
        note: 'Attention is persisted. Checks require a running Gateway, enabled proactivity, and the user context policy. This is not a delivery guarantee.' }) }], details: {} };
    },
  };
}
