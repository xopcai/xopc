import type { AgentTool } from '@earendil-works/pi-agent-core';
import {
  appendProductDeliveryText,
  PRODUCT_DELIVERY_VERSION,
  type PersonalOneShotFollowUpDto,
  type ProductDeliveryEnvelope,
} from '@xopcai/gateway-contract';
import { Type, type Static } from '@sinclair/typebox';

import { boundedPersonalResult } from './personal-result-budget.js';
import type { Config } from '../../config/schema.js';
import { getPersonalAgentByConversation } from '../../personal-agent/repository.js';
import {
  isExplicitOneShotFollowUp,
  isExplicitStopFollowUp,
  parseLocalCheckTime,
} from '../../personal-agent/proactivity/follow-up-request.js';
import {
  createOrReuseOneShotFollowUp,
  getOneShotFollowUpDto,
  isActionableOneShotWait,
  OneShotFollowUpValidationError,
  stopOneShotFollowUp,
  waitSummaryText,
} from '../../personal-agent/proactivity/one-shot-follow-up.js';
import {
  applyThreadFeedback,
  getAttention,
  getProactivitySettings,
  listAttention,
  listInterestCandidates,
  patchAttention,
  patchProactivitySettings,
  rollbackStrategy,
  saveAttention,
  strategyState,
  userText,
} from '../../personal-agent/proactivity/repository.js';
import type { MatterInvestigatorService } from '../../proactive-hub/matter-investigator.js';
import {
  createOrReuseMatter,
  getMatter,
  listMatters,
  patchMatter,
  type FollowUpMatter,
} from '../../proactive-hub/matters.js';
import { getSessionInputById, getSessionInputState } from '../../storage/sqlite/session-input-repository.js';
import { readCurrentTranscriptId } from '../../storage/sqlite/session-instance-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { resolveUserContextSessionAccess } from '../../user-context/access-policy.js';

const EXPLICIT_MATTER_RE = /跟进|盯|监控|监听|关注|留意|帮我.*(?:看|查|追|催|了解|注意)|(?:有|出现|如果|要是).*(?:变动|变化|进展|新|补位|名额|降价|回复|更新|阻塞|消息).*(?:告诉|通知|提醒|起草|放工作台|找我)|follow[ -]up|keep (?:an eye|track|watching)|watch|monitor|track|let me know|notify me/iu;

const EventSourceSchema = Type.Object({
  source: Type.Union([
    Type.Literal('gmail'),
    Type.Literal('calendar'),
    Type.Literal('github'),
    Type.Literal('linear'),
    Type.Literal('local_folder'),
    Type.Literal('local_git'),
    Type.Literal('browser'),
    Type.Literal('desktop'),
  ]),
  keyword: Type.Optional(Type.String({ maxLength: 200 })),
  sender: Type.Optional(Type.String({ maxLength: 200 })),
}, { additionalProperties: false });

const schema = Type.Object({
  command: Type.Union([
    Type.Literal('list'),
    Type.Literal('matter_create'),
    Type.Literal('matter_update'),
    Type.Literal('matter_check'),
    Type.Literal('matter_resolve'),
    Type.Literal('follow'),
    Type.Literal('stop'),
    Type.Literal('pause'),
    Type.Literal('end'),
    Type.Literal('resume'),
    Type.Literal('settings'),
    Type.Literal('interests'),
    Type.Literal('feedback'),
    Type.Literal('rollback'),
  ]),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  id: Type.Optional(Type.String()),
  title: Type.Optional(Type.String({ maxLength: 140, description: 'Concise title of the follow-up matter.' })),
  goal: Type.Optional(Type.String({ maxLength: 800, description: 'What the user wants tracked or followed up on.' })),
  notifyWhen: Type.Optional(Type.String({ maxLength: 400, description: 'What change, milestone, or deadline deserves contacting the user.' })),
  doneCriteria: Type.Optional(Type.String({ maxLength: 400, description: 'Optional condition that marks the matter resolved and stops follow-up.' })),
  deadlineLocal: Type.Optional(Type.String({ description: 'Optional deadline YYYY-MM-DDTHH:mm in the user configured timezone.' })),
  deliveryPreference: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('chat'), Type.Literal('inbox')])),
  checkIntervalMinutes: Type.Optional(Type.Integer({ minimum: 15, maximum: 10080, description: 'Check interval in minutes (min 15).' })),
  urls: Type.Optional(Type.Array(Type.String({ maxLength: 2000 }), { maxItems: 4, description: 'Optional public http/https URLs to bind and monitor for this matter.' })),
  eventSources: Type.Optional(Type.Array(EventSourceSchema, { maxItems: 4, description: 'Optional external/local event sources (gmail, github, calendar, linear, local_folder, etc.) to bind to this matter.' })),
  searchQueries: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 3, description: 'Optional read-only web search queries to run on periodic checks for this matter.' })),
  matterStatus: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('paused'), Type.Literal('resolved')])),
  userNote: Type.Optional(Type.String({ maxLength: 600, description: 'Optional supplemental user note or context update for the matter timeline.' })),
  subject: Type.Optional(Type.String({ maxLength: 160 })),
  summary: Type.Optional(Type.String({ maxLength: 1600 })),
  nextCheckAt: Type.Optional(Type.Number()),
  nextCheckLocal: Type.Optional(Type.String({ description: 'Preferred check time: YYYY-MM-DDTHH:mm in the user configured timezone. Use this instead of calculating epoch milliseconds. For vague tomorrow afternoon, use 15:00.' })),
  validUntil: Type.Optional(Type.Number()),
  validUntilLocal: Type.Optional(Type.String({ description: 'Optional end deadline YYYY-MM-DDTHH:mm in the user configured timezone for a one-shot conditional follow-up.' })),
  oneShot: Type.Optional(Type.Boolean({ description: 'Set true for a one-shot conditional reminder tied to a Task pending item (user_input or approval).' })),
  taskId: Type.Optional(Type.String()),
  waitId: Type.Optional(Type.String({ description: 'Specific TaskWait ID when following up on a pending user_input or approval item.' })),
  destination: Type.Optional(Type.Union([Type.Literal('personal'), Type.Literal('workbench')])),
  confirmReplace: Type.Optional(Type.Boolean({ description: 'Set true only after the user explicitly confirms replacing an existing active follow-up with different timing or destination.' })),
  projectId: Type.Optional(Type.String()),
  mode: Type.Optional(Type.Union([Type.Literal('off'), Type.Literal('follow_up'), Type.Literal('balanced')])),
  feedback: Type.Optional(Type.Union([Type.Literal('stop'), Type.Literal('defer'), Type.Literal('adjust')])),
  preparation: Type.Optional(Type.Union([Type.Literal('brief'), Type.Literal('thorough')])),
  versionId: Type.Optional(Type.String({ description: 'Latest strategy version ID returned by list; required for rollback.' })),
}, { additionalProperties: false, anyOf: [
  { properties: { command: { enum: ['list', 'settings', 'interests', 'stop', 'matter_create', 'matter_update', 'matter_check', 'matter_resolve'] } } },
  { properties: { command: { const: 'follow' } } },
  { properties: { command: { enum: ['pause', 'end', 'resume'] } }, required: ['id'] },
  { properties: { command: { const: 'feedback' } }, required: ['id', 'feedback'] },
  { properties: { command: { const: 'rollback' } }, required: ['id', 'versionId'] },
] });

function followUpDeliveryEnvelope(
  followUp: PersonalOneShotFollowUpDto,
  operation: 'created' | 'updated',
): ProductDeliveryEnvelope {
  return {
    version: PRODUCT_DELIVERY_VERSION,
    operation,
    primary: {
      kind: 'personal_follow_up',
      id: followUp.followUpId,
      title: followUp.taskTitle ?? followUp.subject,
      summary: followUp.waitSummary ?? followUp.summary,
      status: followUp.displayState,
      revision: String(followUp.revision),
      ...(followUp.projectId ? { projectId: followUp.projectId } : {}),
      capabilities: ['open'],
    },
  };
}

function resolveCurrentUserTurnSource(conversationId: string): {
  entryId: string;
  payloadJson: string;
  sessionInputId?: string;
  contextTaskIds: string[];
} | undefined {
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

  const parsedPayload = JSON.parse(row.payload_json) as {
    metadata?: { sourceContexts?: Array<{ kind?: unknown; sourceId?: unknown }> };
  };
  const inputTaskIds = (activeInput?.contextRefs ?? [])
    .filter(ref => ref.kind === 'task' && typeof ref.sourceId === 'string' && ref.sourceId.trim())
    .map(ref => ref.sourceId.trim());
  const metadataTaskIds = (parsedPayload.metadata?.sourceContexts ?? [])
    .filter(ref => ref?.kind === 'task' && typeof ref.sourceId === 'string' && ref.sourceId.trim())
    .map(ref => String(ref.sourceId).trim());
  const contextTaskIds = [...new Set([...inputTaskIds, ...metadataTaskIds])];

  return {
    entryId: row.entry_id,
    payloadJson: row.payload_json,
    ...(activeInput?.id ? { sessionInputId: activeInput.id } : {}),
    contextTaskIds,
  };
}

function linkedConversationWaitingTaskIds(conversationId: string): string[] {
  const db = getSqliteDatabase();
  const originRows = db.prepare(`
    SELECT DISTINCT l.task_id
    FROM task_origin_links l
    JOIN tasks t ON t.task_id = l.task_id
    WHERE l.conversation_id = ? AND t.phase != 'closed'
    ORDER BY t.updated_at DESC
    LIMIT 10
  `).all(conversationId) as Array<{ task_id: string }>;
  const deliveryRows = db.prepare(`
    SELECT DISTINCT r.task_id
    FROM task_result_deliveries d
    JOIN task_runs r ON r.run_id = d.task_run_id
    JOIN tasks t ON t.task_id = r.task_id
    WHERE d.conversation_id = ? AND t.phase != 'closed'
    ORDER BY d.created_at DESC
    LIMIT 10
  `).all(conversationId) as Array<{ task_id: string }>;

  const runs = new TaskRunRepository();
  const allIds = [...new Set([...originRows.map(r => r.task_id), ...deliveryRows.map(r => r.task_id)])];
  return allIds.filter(taskId => runs.listActiveWaits(taskId).some(isActionableOneShotWait));
}

function matchByUtterance<T>(items: T[], text: string, labelOf: (item: T) => string): T[] {
  const normalizedText = text.toLocaleLowerCase();
  const hits = items.filter(item => {
    const label = labelOf(item).trim().toLocaleLowerCase();
    if (!label) return false;
    if (normalizedText.includes(label)) return true;
    const tokens = label.split(/[\s·,，。：:()（）/\-_]+/u).filter(tok => tok.length >= 2);
    return tokens.some(tok => normalizedText.includes(tok));
  });
  return hits.length > 0 ? hits : items;
}

function resolveTargetMatter(
  ownerId: string,
  id: string | undefined,
  utterance: string,
): { matter?: FollowUpMatter; ambiguous?: FollowUpMatter[] } {
  const active = listMatters(ownerId, { includeClosed: false });
  if (id) {
    return { matter: getMatter(ownerId, id) };
  }
  if (active.length === 0) return {};
  if (active.length === 1) return { matter: active[0] };
  const narrowed = matchByUtterance(active, utterance, m => `${m.title} ${m.goal}`);
  if (narrowed.length === 1) return { matter: narrowed[0] };
  return { ambiguous: narrowed };
}

export function createPersonalAttentionTool(deps: {
  getConversationId: () => string | undefined;
  getConfig: () => Config | undefined;
  canReadTask?: (taskId: string) => boolean;
  onFollowUpUpdated?: (info: { followUpId: string; taskId: string; conversationId: string }) => void;
  getMatterInvestigator?: () => MatterInvestigatorService | undefined;
  onMatterMutated?: (info: { matterId: string; kind: 'created' | 'updated' | 'resolved' }) => void;
}): AgentTool<typeof schema, Record<string, unknown>> {
  return {
    name: 'personal_attention',
    label: 'Personal follow-up',
    description: 'Create, inspect, check, update, or resolve user Follow-Up Matters and conditional follow-ups. Prefer command="matter_create" whenever the user asks to follow up on an ongoing matter/thing (e.g. waiting for a reply, tracking release blockers, monitoring a webpage or topic with search queries, or combining multiple sources until done). Use command="matter_check" to investigate current progress immediately, command="matter_update" to add sources/notes/pause/resume, and command="matter_resolve" or "stop" when finished. Use command="follow" with oneShot=true specifically for a one-shot reminder tied to an active Task pending item.',
    parameters: schema,
    async execute(_toolId, input: Static<typeof schema>) {
      const conversationId = deps.getConversationId();
      const personal = conversationId ? getPersonalAgentByConversation(conversationId) : null;
      const config = deps.getConfig();
      if (!personal || !conversationId || !config) throw new Error('Personal attention is unavailable');
      if ((input.command === 'follow' || input.command === 'matter_create' || input.command === 'matter_update' || input.command === 'resume')
        && (!resolveUserContextSessionAccess(config, conversationId).userModel || config.userContext.userModel.writePolicy === 'deny')) {
        throw new Error('Personal attention is unavailable');
      }
      if (input.command === 'settings' && !input.mode) return { content: [{ type: 'text', text: JSON.stringify(getProactivitySettings(personal.ownerId)) }], details: {} };
      if (input.command === 'interests' || input.command === 'list') {
        if (input.command === 'interests' && !resolveUserContextSessionAccess(config, conversationId).userModel) throw new Error('Interest access is unavailable');
        const rows = input.command === 'interests' ? listInterestCandidates(conversationId)
          : listAttention(conversationId).map(thread => {
              if (thread.follow_up_mode === 'one_shot') {
                const dto = getOneShotFollowUpDto(thread.id, personal.ownerId, { canReadTask: deps.canReadTask });
                return {
                  id: thread.id,
                  followUpId: thread.id,
                  followUpMode: 'one_shot' as const,
                  subject: dto?.subject ?? thread.subject,
                  status: thread.status,
                  displayState: dto?.displayState,
                  taskId: thread.task_id,
                  waitId: thread.wait_id,
                  destination: thread.destination,
                  checkAt: thread.check_at,
                  validUntil: thread.valid_until,
                  terminalReason: thread.terminal_reason,
                  revision: thread.revision,
                };
              }
              return {
                id: thread.id,
                followUpMode: 'recurring' as const,
                subject: thread.subject,
                status: thread.status,
                nextCheckAt: thread.next_check_at,
                lastCheckedAt: thread.last_checked_at,
                revision: thread.revision,
                strategy: strategyState(thread.id),
              };
            });
        const offset = input.offset ?? 0;
        const matters = input.command === 'list'
          ? listMatters(personal.ownerId, { includeClosed: false }).map(m => ({
              matterId: m.id,
              title: m.title,
              goal: m.goal,
              notifyWhen: m.notifyWhen,
              doneCriteria: m.doneCriteria,
              status: m.status,
              lastSummary: m.lastSummary,
              lastCheckedAt: m.lastCheckedAt,
              nextCheckAt: m.nextCheckAt,
              deadlineAt: m.deadlineAt,
              bindings: m.bindings,
              recentProgress: m.progressLog.slice(0, 3),
              revision: m.revision,
            }))
          : undefined;
        return { content: [{ type: 'text', text: JSON.stringify(boundedPersonalResult({
          ...(matters && matters.length > 0 ? { matters } : {}),
          items: rows.slice(offset, offset + (input.limit ?? 10)),
          total: rows.length,
          offset,
        })) }], details: {} };
      }

      const source = resolveCurrentUserTurnSource(conversationId);
      if (!source) throw new Error('An explicit user source is required');
      const sourceText = userText(JSON.parse(source.payloadJson));
      const settings = getProactivitySettings(personal.ownerId);
      const nextCheckAt = input.nextCheckLocal ? parseLocalCheckTime(input.nextCheckLocal, settings.timezone) : input.nextCheckAt;

      if (input.command === 'settings') {
        const patterns = { off: /关闭.*主动|不要.*主动|别.*主动|停.*主动|disable|turn off|no.*proactive/iu,
          follow_up: /(?:仅|只|少|only|less).*(?:跟进|提醒|联系|follow|remind|contact)/iu,
          balanced: /(?:开启|恢复|允许|可以|更).*(?:主动|联系)|enable.*proactive|more proactive/iu };
        if (!input.mode || !patterns[input.mode].test(sourceText)) throw new Error('An explicit mode instruction is required');
        const updatedSettings = patchProactivitySettings(personal.ownerId, { ...getProactivitySettings(personal.ownerId), mode: input.mode });
        return { content: [{ type: 'text', text: JSON.stringify(updatedSettings) }], details: {} };
      }

      if (input.command === 'matter_create') {
        if (!EXPLICIT_MATTER_RE.test(sourceText)) {
          throw new Error('An explicit follow-up instruction from the user is required');
        }
        const title = input.title?.trim() || input.subject?.trim();
        const goal = input.goal?.trim() || input.summary?.trim() || sourceText.slice(0, 400);
        const notifyWhen = input.notifyWhen?.trim() || goal.slice(0, 300);
        if (!title) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                saved: false,
                status: 'clarification_needed',
                reason: 'missing_matter_title',
                message: '请给出简短明确的事项标题以便持续跟进。',
              }),
            }],
            details: {},
          };
        }
        try {
          const deadlineAt = input.deadlineLocal ? parseLocalCheckTime(input.deadlineLocal, settings.timezone) : null;
          const created = createOrReuseMatter({
            ownerId: personal.ownerId,
            conversationId,
            title,
            goal,
            notifyWhen,
            doneCriteria: input.doneCriteria,
            deliveryPreference: input.deliveryPreference ?? 'auto',
            deadlineAt,
            checkIntervalMs: input.checkIntervalMinutes !== undefined ? input.checkIntervalMinutes * 60_000 : undefined,
            projectId: input.projectId,
            taskId: input.taskId,
            urls: input.urls,
            eventSources: input.eventSources,
            searchQueries: input.searchQueries,
            blocklist: config.tools?.web?.blocklist,
          });
          if (created.outcome === 'created') {
            deps.onMatterMutated?.({ matterId: created.matter.id, kind: 'created' });
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                saved: true,
                outcome: created.outcome,
                matterId: created.matter.id,
                title: created.matter.title,
                goal: created.matter.goal,
                notifyWhen: created.matter.notifyWhen,
                doneCriteria: created.matter.doneCriteria,
                status: created.matter.status,
                deadlineAt: created.matter.deadlineAt,
                checkIntervalMinutes: Math.round(created.matter.checkIntervalMs / 60_000),
                bindings: created.matter.bindings,
                revision: created.matter.revision,
                note: 'Follow-up matter is active. The Gateway will periodically investigate bound sources (read-only), update the matter timeline silently when nothing changed, and contact you with concrete findings or drafts when action is needed.',
              }),
            }],
            details: { matter: created.matter },
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                saved: false,
                status: 'invalid_matter',
                message: error instanceof Error ? error.message : String(error),
              }),
            }],
            details: {},
          };
        }
      }

      if (input.command === 'matter_update') {
        const resolved = resolveTargetMatter(personal.ownerId, input.id, sourceText);
        if (resolved.ambiguous) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                saved: false,
                status: 'clarification_needed',
                reason: 'ambiguous_matter',
                candidates: resolved.ambiguous.map(m => ({ matterId: m.id, title: m.title, status: m.status })),
                message: '存在多个正在跟进的事项，请只问一句确认要调整哪一件。',
              }),
            }],
            details: {},
          };
        }
        if (!resolved.matter) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ saved: false, status: 'not_found', message: '未找到对应的跟进事项。' }) }],
            details: {},
          };
        }
        const deadlineAt = input.deadlineLocal ? parseLocalCheckTime(input.deadlineLocal, settings.timezone) : undefined;
        const { matter } = patchMatter(personal.ownerId, resolved.matter.id, {
          title: input.title,
          goal: input.goal,
          notifyWhen: input.notifyWhen,
          doneCriteria: input.doneCriteria,
          status: input.matterStatus,
          deliveryPreference: input.deliveryPreference,
          deadlineAt,
          checkIntervalMs: input.checkIntervalMinutes !== undefined ? input.checkIntervalMinutes * 60_000 : undefined,
          userNote: input.userNote,
          addUrls: input.urls,
          addEventSources: input.eventSources,
          addSearchQueries: input.searchQueries,
          blocklist: config.tools?.web?.blocklist,
        });
        deps.onMatterMutated?.({ matterId: matter.id, kind: matter.status === 'resolved' ? 'resolved' : 'updated' });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              saved: true,
              matterId: matter.id,
              title: matter.title,
              status: matter.status,
              lastSummary: matter.lastSummary,
              bindings: matter.bindings,
              revision: matter.revision,
            }),
          }],
          details: { matter },
        };
      }

      if (input.command === 'matter_check') {
        const resolved = resolveTargetMatter(personal.ownerId, input.id, sourceText);
        if (resolved.ambiguous) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                checked: false,
                status: 'clarification_needed',
                reason: 'ambiguous_matter',
                candidates: resolved.ambiguous.map(m => ({ matterId: m.id, title: m.title, status: m.status })),
                message: '存在多个正在跟进的事项，请确认要立刻检查哪一件。',
              }),
            }],
            details: {},
          };
        }
        if (!resolved.matter) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ checked: false, status: 'not_found', message: '未找到对应的跟进事项。' }) }],
            details: {},
          };
        }
        const investigator = deps.getMatterInvestigator?.();
        const checked = investigator
          ? await investigator.checkNow(resolved.matter.id, personal.ownerId)
          : resolved.matter;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              checked: Boolean(investigator),
              matterId: checked.id,
              title: checked.title,
              status: checked.status,
              lastSummary: checked.lastSummary,
              lastCheckedAt: checked.lastCheckedAt,
              nextCheckAt: checked.nextCheckAt,
              lastError: checked.lastError,
              recentProgress: checked.progressLog.slice(0, 4),
            }),
          }],
          details: { matter: checked },
        };
      }

      if (input.command === 'matter_resolve') {
        if (!isExplicitStopFollowUp(sourceText) && !/搞定|完成|解决|结束|报上了|已确认|done|resolved|finished|completed/iu.test(sourceText)) {
          throw new Error('An explicit completion or stop instruction from the user is required');
        }
        const resolved = resolveTargetMatter(personal.ownerId, input.id, sourceText);
        if (resolved.ambiguous) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                resolved: false,
                status: 'clarification_needed',
                reason: 'ambiguous_matter',
                candidates: resolved.ambiguous.map(m => ({ matterId: m.id, title: m.title })),
                message: '存在多个正在跟进的事项，请确认要结束哪一件。',
              }),
            }],
            details: {},
          };
        }
        if (!resolved.matter) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ resolved: false, status: 'not_found', message: '当前没有匹配的活动跟进事项。' }) }],
            details: {},
          };
        }
        const { matter } = patchMatter(personal.ownerId, resolved.matter.id, {
          status: 'resolved',
          userNote: input.userNote,
        });
        deps.onMatterMutated?.({ matterId: matter.id, kind: 'resolved' });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              resolved: true,
              matterId: matter.id,
              title: matter.title,
              status: matter.status,
              message: `已结束跟进「${matter.title}」，并停止名下所有监控来源。`,
            }),
          }],
          details: { matter },
        };
      }

      // Explicit stop branch for one-shot follow-ups or follow-up matters
      if (input.command === 'stop') {
        if (!isExplicitStopFollowUp(sourceText)) {
          throw new Error('An explicit stop instruction from the user is required');
        }
        const db = getSqliteDatabase();
        let targetId = input.id;
        if (!targetId) {
          const candidates = (db.prepare(`
            SELECT id, task_id, subject FROM personal_attention_threads
            WHERE owner_id = ? AND follow_up_mode = 'one_shot' AND status = 'active'
            ORDER BY updated_at DESC
          `).all(personal.ownerId) as Array<{ id: string; task_id: string | null; subject: string }>)
            .filter(item => !input.taskId || item.task_id === input.taskId);
          const scopedByContext = source.contextTaskIds.length > 0
            ? candidates.filter(item => item.task_id && source.contextTaskIds.includes(item.task_id))
            : candidates;
          const narrowed = scopedByContext.length > 1
            ? matchByUtterance(scopedByContext, sourceText, item => item.subject)
            : scopedByContext;
          if (narrowed.length === 0) {
            const matterMatch = resolveTargetMatter(personal.ownerId, input.id, sourceText);
            if (matterMatch.ambiguous) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    status: 'clarification_needed',
                    reason: 'ambiguous_matter',
                    candidates: matterMatch.ambiguous.map(m => ({ matterId: m.id, title: m.title })),
                    message: '存在多条正在跟进的事项，请确认要停止哪一件。',
                  }),
                }],
                details: {},
              };
            }
            if (matterMatch.matter) {
              const { matter } = patchMatter(personal.ownerId, matterMatch.matter.id, { status: 'resolved' });
              deps.onMatterMutated?.({ matterId: matter.id, kind: 'resolved' });
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    outcome: 'stopped',
                    matterId: matter.id,
                    title: matter.title,
                    status: matter.status,
                    message: `已停止跟进「${matter.title}」。`,
                  }),
                }],
                details: { matter },
              };
            }
            return {
              content: [{ type: 'text', text: JSON.stringify({ status: 'not_found', message: '当前没有正在进行的跟进事项。' }) }],
              details: {},
            };
          }
          if (narrowed.length > 1) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  status: 'clarification_needed',
                  reason: 'ambiguous_follow_up',
                  candidates: narrowed.map(c => ({ followUpId: c.id, taskId: c.task_id, subject: c.subject })),
                  message: '存在多条正在进行的条件跟进，请向用户确认要停止哪一件。',
                }),
              }],
              details: {},
            };
          }
          targetId = narrowed[0]!.id;
        }
        const stopped = stopOneShotFollowUp({
          ownerId: personal.ownerId,
          followUpId: targetId,
          idempotencyKey: `input:${source.sessionInputId ?? source.entryId}:stop:${targetId}`,
          sourceEntryId: source.entryId,
          canReadTask: deps.canReadTask,
        });
        deps.onFollowUpUpdated?.({
          followUpId: stopped.followUp.followUpId,
          taskId: stopped.followUp.taskId,
          conversationId,
        });
        const delivery = followUpDeliveryEnvelope(stopped.followUp, 'updated');
        const payload = {
          outcome: stopped.outcome,
          followUpId: stopped.followUp.followUpId,
          followUp: stopped.followUp,
          message: stopped.outcome === 'already_delivered'
            ? '这条已提醒，跟进已结束。'
            : '已停止这次跟进。',
        };
        return {
          content: [{ type: 'text', text: appendProductDeliveryText(JSON.stringify(payload), delivery) }],
          details: { delivery, followUp: stopped.followUp },
        };
      }

      if (input.command === 'follow') {
        const linkedWaitingTasks = linkedConversationWaitingTaskIds(conversationId);
        const wantsOneShot = input.oneShot === true
          || Boolean(input.waitId)
          || Boolean(input.destination)
          || Boolean(input.validUntilLocal)
          || input.validUntil !== undefined
          || (isExplicitOneShotFollowUp(sourceText)
            && (Boolean(input.taskId) || source.contextTaskIds.length > 0 || linkedWaitingTasks.length > 0));

        if (wantsOneShot) {
          const tasks = new TaskRepository();
          const runs = new TaskRunRepository();

          let candidateTaskIds: string[] = [];
          if (input.taskId) {
            candidateTaskIds = [input.taskId];
          } else if (source.contextTaskIds.length > 0) {
            candidateTaskIds = source.contextTaskIds;
          } else {
            candidateTaskIds = linkedWaitingTasks;
          }

          if (candidateTaskIds.length === 0) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  saved: false,
                  status: 'clarification_needed',
                  reason: 'missing_task_target',
                  message: '尚未识别到关联的待处理任务，请先确认用户指的是哪项任务，或从工作台任务详情带引用发起讨论。',
                }),
              }],
              details: {},
            };
          }

          if (candidateTaskIds.length > 1) {
            const loaded = candidateTaskIds
              .map(id => tasks.get(id))
              .filter((item): item is NonNullable<ReturnType<TaskRepository['get']>> => Boolean(item));
            const narrowedTasks = matchByUtterance(loaded, sourceText, item => item.title);
            if (narrowedTasks.length !== 1) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    saved: false,
                    status: 'clarification_needed',
                    reason: 'ambiguous_task',
                    candidates: narrowedTasks.map(item => ({ taskId: item.id, title: item.title })),
                    message: '存在多个可能匹配的任务，请只追问一个问题确认具体是哪项任务。',
                  }),
                }],
                details: {},
              };
            }
            candidateTaskIds = [narrowedTasks[0]!.id];
          }

          const resolvedTaskId = candidateTaskIds[0]!;
          if (deps.canReadTask && !deps.canReadTask(resolvedTaskId)) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  saved: false,
                  status: 'access_denied',
                  taskId: resolvedTaskId,
                  message: '当前会话无权访问该任务，无法为其建立后台条件检查。',
                }),
              }],
              details: {},
            };
          }

          const targetTask = tasks.get(resolvedTaskId);
          if (!targetTask || targetTask.phase === 'closed') {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  saved: false,
                  status: 'task_unavailable',
                  taskId: resolvedTaskId,
                  message: '目标任务不存在或已关闭，无法建立条件跟进。',
                }),
              }],
              details: {},
            };
          }

          let resolvedWaitId = input.waitId;
          if (!resolvedWaitId) {
            const activeWaits = runs.listActiveWaits(targetTask.id).filter(isActionableOneShotWait);
            if (activeWaits.length === 0) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    saved: false,
                    status: 'unsupported_condition',
                    taskId: targetTask.id,
                    taskTitle: targetTask.title,
                    message: '该任务当前没有可核验的待决项（需输入或待审批）。首期条件跟进仅覆盖已存在的任务待决项，暂不直接监控外部看板状态。',
                  }),
                }],
                details: {},
              };
            }
            const narrowedWaits = activeWaits.length > 1
              ? matchByUtterance(activeWaits, sourceText, wait => waitSummaryText(wait))
              : activeWaits;
            if (narrowedWaits.length !== 1) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    saved: false,
                    status: 'clarification_needed',
                    reason: 'ambiguous_wait',
                    taskId: targetTask.id,
                    taskTitle: targetTask.title,
                    candidates: narrowedWaits.map(wait => ({
                      waitId: wait.id,
                      kind: wait.kind,
                      summary: waitSummaryText(wait),
                    })),
                    message: '该任务下存在多个待决项，请只问一句确认具体要跟进哪一个待决项。',
                  }),
                }],
                details: {},
              };
            }
            resolvedWaitId = narrowedWaits[0]!.id;
          }

          try {
            const created = createOrReuseOneShotFollowUp({
              conversationId,
              config,
              entryId: source.entryId,
              sessionInputId: source.sessionInputId,
              taskId: targetTask.id,
              waitId: resolvedWaitId,
              subject: input.subject,
              summary: input.summary,
              destination: input.destination,
              checkAt: nextCheckAt,
              checkAtLocal: input.nextCheckLocal,
              validUntil: input.validUntil,
              validUntilLocal: input.validUntilLocal,
              confirmReplace: input.confirmReplace,
              canReadTask: deps.canReadTask,
            });

            if (created.outcome === 'conflict_existing_active') {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    saved: false,
                    status: 'clarification_needed',
                    reason: 'existing_active_follow_up_differs',
                    existing: created.existing,
                    message: '同一待决项已有不同时间或送达位置的进行中跟进；请先与用户确认是否替换为新约定（确认后传 confirmReplace=true）。',
                  }),
                }],
                details: { existingFollowUp: created.existing },
              };
            }

            deps.onFollowUpUpdated?.({
              followUpId: created.followUp.followUpId,
              taskId: created.followUp.taskId,
              conversationId,
            });
            const delivery = followUpDeliveryEnvelope(
              created.followUp,
              created.outcome === 'created' ? 'created' : 'updated',
            );
            const fmt = (ms: number) => new Intl.DateTimeFormat('sv-SE', {
              timeZone: created.followUp.timezone,
              dateStyle: 'short',
              timeStyle: 'short',
            }).format(ms);
            const payload = {
              saved: true,
              outcome: created.outcome,
              followUpId: created.followUp.followUpId,
              status: created.followUp.status,
              displayState: created.followUp.displayState,
              taskId: created.followUp.taskId,
              taskTitle: created.followUp.taskTitle,
              waitId: created.followUp.waitId,
              waitSummary: created.followUp.waitSummary,
              destination: created.followUp.destination,
              timezone: created.followUp.timezone,
              checkAt: created.followUp.checkAt,
              checkAtLocal: fmt(created.followUp.checkAt),
              validUntil: created.followUp.validUntil,
              validUntilLocal: fmt(created.followUp.validUntil),
              validUntilSource: created.validUntilSource,
              ...(created.scheduleIntervalMs ? { scheduleIntervalMs: created.scheduleIntervalMs } : {}),
            };
            return {
              content: [{ type: 'text', text: appendProductDeliveryText(JSON.stringify(payload), delivery) }],
              details: { delivery, followUp: created.followUp },
            };
          } catch (error) {
            if (error instanceof OneShotFollowUpValidationError && error.code !== 'explicit_request_required') {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    saved: false,
                    status: error.code,
                    message: error.message,
                  }),
                }],
                details: {},
              };
            }
            throw error;
          }
        }

        if (!input.subject) throw new Error('A subject is required');
        const thread = saveAttention({
          conversationId,
          subject: input.subject,
          summary: input.summary ?? input.subject,
          kind: 'outcome',
          entryIds: [source.entryId],
          explicit: true,
          nextCheckAt: nextCheckAt ?? Date.now() + 86_400_000,
          taskId: input.taskId,
          projectId: input.projectId,
        });
        if (thread.authority !== 'user_explicit') throw new Error('Follow-up must be explicitly requested');
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: thread.id,
              status: thread.status,
              nextCheckAt: thread.next_check_at,
              strategy: strategyState(thread.id),
              timezone: settings.timezone,
              nextCheckLocal: thread.next_check_at === null
                ? null
                : new Intl.DateTimeFormat('sv-SE', { timeZone: settings.timezone, dateStyle: 'short', timeStyle: 'short' }).format(thread.next_check_at),
              note: 'Attention is persisted. Checks require a running Gateway, enabled proactivity, and the user context policy. This is not a delivery guarantee.',
            }),
          }],
          details: {},
        };
      }

      let thread;
      if (input.command === 'feedback' || input.command === 'rollback') {
        const current = input.id ? getAttention(input.id, personal.ownerId) : undefined;
        if (!current || current.conversation_id !== conversationId) throw new Error('Attention is unavailable');
        if (input.command === 'rollback') {
          if (!/撤销|撤回|回滚|恢复.*(?:之前|原来)|undo|roll\s?back/iu.test(sourceText) || !input.versionId) {
            throw new Error('An explicit undo instruction and latest version ID are required');
          }
          thread = rollbackStrategy(personal.ownerId, current.id, {
            versionId: input.versionId,
            revision: current.revision,
            idempotencyKey: `input:${source.entryId}:${current.id}`,
          }, source.entryId);
        } else {
          const patterns = {
            stop: /停止|结束|别再|不用.*(?:关注|跟进|提醒|盯)|stop|don't.*(?:follow|remind)/iu,
            defer: /晚点|明天|下周|再说|later|tomorrow|next week/iu,
            adjust: /(?:以后|今后|下次|future|always|next time).*(?:准备|完整|详细|简短|prepare|thorough|brief)|(?:准备|完整|详细|简短|prepare|thorough|brief).*(?:以后|今后|下次|future|always|next time)/iu,
          };
          if (!input.feedback || !patterns[input.feedback].test(sourceText)) {
            throw new Error('An explicit topic feedback instruction is required');
          }
          if (current.follow_up_mode === 'one_shot' && input.feedback === 'stop') {
            const stopped = stopOneShotFollowUp({
              ownerId: personal.ownerId,
              followUpId: current.id,
              expectedRevision: current.revision,
              idempotencyKey: `input:${source.sessionInputId ?? source.entryId}:${current.id}`,
              sourceEntryId: source.entryId,
              canReadTask: deps.canReadTask,
            });
            deps.onFollowUpUpdated?.({
              followUpId: stopped.followUp.followUpId,
              taskId: stopped.followUp.taskId,
              conversationId,
            });
            const delivery = followUpDeliveryEnvelope(stopped.followUp, 'updated');
            return {
              content: [{ type: 'text', text: appendProductDeliveryText(JSON.stringify(stopped), delivery) }],
              details: { delivery, followUp: stopped.followUp },
            };
          }
          thread = applyThreadFeedback(personal.ownerId, current.id, current.revision, {
            idempotencyKey: `input:${source.entryId}:${current.id}`,
            kind: input.feedback,
            scope: 'thread',
            until: input.feedback === 'defer' ? nextCheckAt : undefined,
            preparation: input.feedback === 'adjust' ? input.preparation : undefined,
          }, { entryId: source.entryId });
        }
      } else {
        const current = input.id ? getAttention(input.id, personal.ownerId) : undefined;
        if (!current || current.conversation_id !== conversationId) throw new Error('Attention is unavailable');
        const patterns = {
          pause: /暂停|晚点|再说|下周|明天|pause|later|next week/iu,
          end: /停止|结束|别再|不用.*(?:跟进|关注|提醒|盯)|stop|end|don't.*(?:follow|remind)/iu,
          resume: /恢复|继续|重新|resume|continue/iu,
        };
        if (!patterns[input.command].test(sourceText)) throw new Error('An explicit instruction is required');
        if (current.follow_up_mode === 'one_shot' && input.command === 'end') {
          const stopped = stopOneShotFollowUp({
            ownerId: personal.ownerId,
            followUpId: current.id,
            expectedRevision: current.revision,
            idempotencyKey: `input:${source.sessionInputId ?? source.entryId}:${current.id}`,
            sourceEntryId: source.entryId,
            canReadTask: deps.canReadTask,
          });
          deps.onFollowUpUpdated?.({
            followUpId: stopped.followUp.followUpId,
            taskId: stopped.followUp.taskId,
            conversationId,
          });
          const delivery = followUpDeliveryEnvelope(stopped.followUp, 'updated');
          return {
            content: [{ type: 'text', text: appendProductDeliveryText(JSON.stringify(stopped), delivery) }],
            details: { delivery, followUp: stopped.followUp },
          };
        }
        thread = input.command === 'end'
          ? applyThreadFeedback(personal.ownerId, current.id, current.revision, {
              idempotencyKey: `input:${source.entryId}:${current.id}`,
              kind: 'stop',
              scope: 'thread',
            }, { entryId: source.entryId })
          : patchAttention(personal.ownerId, current.id, current.revision, {
              status: input.command === 'pause' ? 'paused' : 'active',
              nextCheckAt,
            });
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: thread.id,
            status: thread.status,
            nextCheckAt: thread.next_check_at,
            strategy: strategyState(thread.id),
            timezone: settings.timezone,
            nextCheckLocal: thread.next_check_at === null
              ? null
              : new Intl.DateTimeFormat('sv-SE', { timeZone: settings.timezone, dateStyle: 'short', timeStyle: 'short' }).format(thread.next_check_at),
            note: 'Attention is persisted. Checks require a running Gateway, enabled proactivity, and the user context policy. This is not a delivery guarantee.',
          }),
        }],
        details: {},
      };
    },
  };
}
