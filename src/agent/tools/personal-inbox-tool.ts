import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Static } from '@sinclair/typebox';

import type { Config } from '../../config/schema.js';
import { parseLocalCheckTime } from '../../personal-agent/proactivity/follow-up-request.js';
import { getProactivitySettings, userText } from '../../personal-agent/proactivity/repository.js';
import { getPersonalAgentByConversation } from '../../personal-agent/repository.js';
import {
  listBufferedDigestCandidates,
  listProactiveInboxItems,
  listPulseDigests,
} from '../../proactive-hub/repository.js';
import type { ProactiveHubService } from '../../proactive-hub/triage-service.js';
import type { ProactiveItem, ProactiveItemResolutionInput } from '../../proactive-hub/types.js';
import { getSessionInputById, getSessionInputState } from '../../storage/sqlite/session-input-repository.js';
import { readCurrentTranscriptId } from '../../storage/sqlite/session-instance-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { resolveUserContextSessionAccess } from '../../user-context/access-policy.js';
import { boundedPersonalResult } from './personal-result-budget.js';

const QUOTED_RE = /(?:比如|例如|譬如|举例|示例|引用|for example|e\.g\.)[^。！？!?\n;]*?(?:「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"|'[^']*')/giu;
const HYPOTHETICAL_RE = /(?:如果|假如|假设|要是)\s*(?:我|用户|有人)|(?:if|suppose|assuming|what if)\s+(?:i|the user|someone)\b/iu;
const NEGATED_APPROVAL_RE = /(?:不要|不用|先别|别|暂不|拒绝|不同意|不批准|别发|先不发).*(?:批准|同意|采纳|执行|发|提交|确认)|(?:don't|do not|never|reject|decline|not yet).*(?:approve|send|execute|confirm|apply)/iu;

const EXPLICIT_ACTION_PATTERNS: Record<'approve' | 'edit_and_approve' | 'move_to_digest' | 'snooze' | 'mute', RegExp> = {
  approve: /批准|同意|通过|采纳|确认.*(?:执行|发送|提交|发|草稿|方案)|直接(?:发|执行|采纳|用)|按.*(?:发|执行|办)|发吧|发送吧|执行吧|approve|confirm|go ahead|send it|apply it|adopt/iu,
  edit_and_approve: /改(?:成|为|一下)|修改|调整|换成|补(?:上|充)|按我说的|改好.*(?:发|执行|批准)|edit|revise|update.*(?:draft|and approve|and send)|change.*(?:draft|to)/iu,
  move_to_digest: /简报|汇总|摘要|晚点看|放进?简报|归入简报|digest|summary later|move to digest/iu,
  snooze: /稍后|晚点|推迟|明天|下周|延后|snooze|later|remind me later|defer/iu,
  mute: /静音|屏蔽|拦截|别再推|不要再推|不再提醒|以后别|过滤掉|mute|silence|block|stop alerting|don't notify|ignore similar/iu,
};

const schema = Type.Object({
  command: Type.Union([
    Type.Literal('list'),
    Type.Literal('approve'),
    Type.Literal('edit_and_approve'),
    Type.Literal('move_to_digest'),
    Type.Literal('snooze'),
    Type.Literal('mute'),
  ]),
  itemId: Type.Optional(Type.String({ description: 'Proactive Inbox item ID. Omit only when unambiguous.' })),
  editedDraft: Type.Optional(Type.String({ maxLength: 20_000, description: 'Finalized edited draft text for command="edit_and_approve".' })),
  note: Type.Optional(Type.String({ maxLength: 2000, description: 'Optional owner note attached to approval.' })),
  untilLocal: Type.Optional(Type.String({ description: 'Snooze until local time YYYY-MM-DDTHH:mm in configured timezone.' })),
  untilMs: Type.Optional(Type.Number({ description: 'Snooze until epoch milliseconds.' })),
  muteMode: Type.Optional(Type.Union([Type.Literal('drop'), Type.Literal('digest_only')])),
  senderOrSubjectFilter: Type.Optional(Type.String({ maxLength: 320, description: 'Optional sender or keyword filter when muting similar signals.' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
}, { additionalProperties: false });

function resolveLatestOwnerTurn(conversationId: string): { entryId: string; text: string; sessionInputId?: string } | undefined {
  const db = getSqliteDatabase();
  const transcriptId = readCurrentTranscriptId(db, conversationId);
  if (!transcriptId) return undefined;

  const activeInputId = getSessionInputState(conversationId).activeInputId ?? undefined;
  const activeInput = activeInputId ? getSessionInputById(conversationId, activeInputId) : null;
  let row: { entry_id: string; payload_json: string } | undefined;

  if (activeInput) {
    row = db.prepare(`
      SELECT entry_id, payload_json
      FROM transcript_entries
      WHERE transcript_id = ? AND role = 'user'
        AND COALESCE(json_extract(payload_json, '$.metadata.hiddenFromClient'), 0) = 0
        AND (
          json_extract(payload_json, '$.metadata.clientMessageId') = ?
          OR (? IS NOT NULL AND json_extract(payload_json, '$.turnId') = ?)
        )
      ORDER BY seq DESC
      LIMIT 1
    `).get(
      transcriptId,
      activeInput.clientMessageId,
      activeInput.runId ?? null,
      activeInput.runId ?? null,
    ) as { entry_id: string; payload_json: string } | undefined;
  }

  if (!row) {
    row = db.prepare(`
      SELECT entry_id, payload_json
      FROM transcript_entries
      WHERE transcript_id = ? AND role = 'user'
        AND COALESCE(json_extract(payload_json, '$.metadata.hiddenFromClient'), 0) = 0
      ORDER BY seq DESC
      LIMIT 1
    `).get(transcriptId) as { entry_id: string; payload_json: string } | undefined;
  }
  if (!row) return undefined;

  return {
    entryId: row.entry_id,
    text: userText(JSON.parse(row.payload_json)).trim(),
    ...(activeInput?.id ? { sessionInputId: activeInput.id } : {}),
  };
}

function hasExplicitIntent(
  text: string,
  command: 'approve' | 'edit_and_approve' | 'move_to_digest' | 'snooze' | 'mute',
): boolean {
  const clauses = text
    .replace(QUOTED_RE, ' ')
    .split(/[。！？!?\n;；]/u)
    .map(part => part.trim())
    .filter(part => Boolean(part) && !HYPOTHETICAL_RE.test(part));

  if ((command === 'approve' || command === 'edit_and_approve') && clauses.some(c => NEGATED_APPROVAL_RE.test(c))) {
    return false;
  }

  return clauses.some(clause => EXPLICIT_ACTION_PATTERNS[command].test(clause));
}

function cjkBigrams(text: string): Set<string> {
  const runs = text.match(/[\u4e00-\u9fff]{2,}/gu) ?? [];
  const bigrams = new Set<string>();
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i += 1) {
      bigrams.add(run.slice(i, i + 2));
    }
  }
  return bigrams;
}

function matchInboxItems(items: ProactiveItem[], utterance: string): ProactiveItem[] {
  const lower = utterance.toLocaleLowerCase();
  const utteranceBigrams = cjkBigrams(utterance);

  const scored = items.map(item => {
    const title = item.title.trim().toLocaleLowerCase();
    const haystack = `${title} ${item.provenance.source} ${item.category}`.toLocaleLowerCase();
    let score = 0;
    if (title && lower.includes(title)) score += 10;
    const tokens = haystack.split(/[\s·,，。：:()（）/\-_]+/u).filter(tok => tok.length >= 2);
    for (const tok of tokens) {
      if (lower.includes(tok)) score += 3;
    }
    if (utteranceBigrams.size > 0) {
      const titleBigrams = cjkBigrams(`${item.title} ${item.summary}`);
      let bigramHits = 0;
      for (const bg of titleBigrams) {
        if (utteranceBigrams.has(bg)) bigramHits += 1;
      }
      if (bigramHits >= 2) score += bigramHits;
    }
    return { item, score };
  });

  const positive = scored.filter(entry => entry.score > 0).sort((a, b) => b.score - a.score);
  if (positive.length === 0) return items;
  if (positive.length === 1 || positive[0]!.score > positive[1]!.score) {
    return [positive[0]!.item];
  }
  return positive.filter(entry => entry.score === positive[0]!.score).map(entry => entry.item);
}

export function createPersonalInboxTool(deps: {
  getConversationId: () => string | undefined;
  getConfig: () => Config | undefined;
  getProactiveHubService: () => ProactiveHubService | undefined;
}): AgentTool<typeof schema, Record<string, unknown>> {
  return {
    name: 'personal_inbox',
    label: 'Proactive inbox',
    description: 'Inspect and act on pending Proactive Inbox items (prepared drafts, external signal alerts, RSI skill candidates, and Pulse digests) directly from conversation across Web, Desktop, Mobile, Voice, or IM. Always check items with command="list" when the user asks about pending proactive updates or refers to a draft/alert. For approve, edit_and_approve, move_to_digest, snooze, or mute, require explicit owner intent in the current turn; if multiple pending items match, ask one short clarifying question instead of guessing.',
    parameters: schema,
    async execute(_toolId, input: Static<typeof schema>) {
      const conversationId = deps.getConversationId();
      const personal = conversationId ? getPersonalAgentByConversation(conversationId) : null;
      const config = deps.getConfig();
      const hub = deps.getProactiveHubService();
      if (!personal || !conversationId || !config) {
        throw new Error('Personal proactive inbox is unavailable');
      }
      if (!resolveUserContextSessionAccess(config, conversationId).userModel) {
        throw new Error('Proactive inbox access is unavailable under the current user context policy');
      }

      if (input.command === 'list') {
        const limit = input.limit ?? 10;
        const pending = listProactiveInboxItems(personal.ownerId, { limit })
          .filter(item => item.category !== 'pulse_digest')
          .map(item => ({
            id: item.id,
            title: item.title,
            summary: item.summary.slice(0, 600),
            tier: item.tier,
            category: item.category,
            source: item.provenance.source,
            reason: item.provenance.reason,
            verifiedFacts: item.preparedPayload?.verifiedFacts.slice(0, 5) ?? [],
            preparedDraft: item.preparedPayload?.preparedDraft?.slice(0, 1600),
            proposedAction: item.proposedAction,
            createdAt: item.createdAt,
          }));
        const digests = listPulseDigests(personal.ownerId, 3).map(d => ({
          id: d.id,
          title: d.title,
          summary: d.summary.slice(0, 800),
          createdAt: d.createdAt,
        }));
        const bufferedCount = listBufferedDigestCandidates(personal.ownerId).length;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(boundedPersonalResult({
              items: pending,
              total: pending.length,
              digests,
              bufferedCount,
            })),
          }],
          details: {},
        };
      }

      if (!hub) {
        throw new Error('Proactive Hub service is unavailable');
      }
      const turn = resolveLatestOwnerTurn(conversationId);
      if (!turn || !turn.text) {
        throw new Error('An explicit owner message in the active conversation is required');
      }
      if (!hasExplicitIntent(turn.text, input.command)) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              applied: false,
              status: 'confirmation_required',
              message: '该操作需要用户在当前对话中明确确认（例如“批准执行”、“按修改后的草稿发送”或“静音此类提醒”），请先向用户确认。',
            }),
          }],
          details: {},
        };
      }

      const pending = listProactiveInboxItems(personal.ownerId, { limit: 20 })
        .filter(item => item.category !== 'pulse_digest');

      let target: ProactiveItem | undefined;
      if (input.itemId) {
        target = pending.find(item => item.id === input.itemId);
        if (!target) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                applied: false,
                status: 'not_found',
                message: '未找到对应的待处理主动收件箱条目，可能已被处理或已过期。',
              }),
            }],
            details: {},
          };
        }
      } else {
        if (pending.length === 0) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                applied: false,
                status: 'not_found',
                message: '当前主动收件箱里没有待处理条目。',
              }),
            }],
            details: {},
          };
        }
        const narrowed = pending.length > 1 ? matchInboxItems(pending, turn.text) : pending;
        if (narrowed.length !== 1) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                applied: false,
                status: 'clarification_needed',
                reason: 'ambiguous_inbox_item',
                candidates: narrowed.slice(0, 5).map(item => ({
                  itemId: item.id,
                  title: item.title,
                  source: item.provenance.source,
                  proposedAction: item.proposedAction?.label,
                })),
                message: '主动收件箱中有多条待处理内容，请只追问一句确认要处理哪一条。',
              }),
            }],
            details: {},
          };
        }
        target = narrowed[0]!;
      }

      const idempotencyKey = `chat:${turn.sessionInputId ?? turn.entryId}:${target.id}:${input.command}`;
      let resolution: ProactiveItemResolutionInput;
      if (input.command === 'approve') {
        resolution = {
          action: 'approve',
          idempotencyKey,
          ...(input.note ? { note: input.note } : {}),
        };
      } else if (input.command === 'edit_and_approve') {
        const edited = input.editedDraft?.trim();
        if (!edited) {
          throw new Error('editedDraft is required for edit_and_approve');
        }
        resolution = {
          action: 'edit_and_approve',
          idempotencyKey,
          editedDraft: edited,
          ...(input.note ? { note: input.note } : {}),
        };
      } else if (input.command === 'move_to_digest') {
        resolution = {
          action: 'move_to_digest',
          idempotencyKey,
        };
      } else if (input.command === 'snooze') {
        const settings = getProactivitySettings(personal.ownerId);
        const untilMs = input.untilLocal
          ? parseLocalCheckTime(input.untilLocal, settings.timezone)
          : (input.untilMs ?? Date.now() + 4 * 3_600_000);
        resolution = {
          action: 'snooze',
          idempotencyKey,
          untilMs,
        };
      } else {
        resolution = {
          action: 'mute_rule',
          idempotencyKey,
          mode: input.muteMode ?? 'drop',
          ...(input.senderOrSubjectFilter?.trim() ? { senderOrSubjectFilter: input.senderOrSubjectFilter.trim() } : {}),
        };
      }

      const resolved = await hub.resolveItem(target.id, resolution, personal.ownerId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            applied: true,
            itemId: resolved.id,
            title: resolved.title,
            state: resolved.state,
            action: resolution.action,
            ...(resolved.humanResolution?.executedAction
              ? { executedAction: resolved.humanResolution.executedAction }
              : {}),
          }),
        }],
        details: { item: resolved },
      };
    },
  };
}
