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
import { getSessionInputById, getSessionInputState } from '../../storage/sqlite/session-input-repository.js';
import { readCurrentTranscriptId } from '../../storage/sqlite/session-instance-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { resolveUserContextSessionAccess } from '../../user-context/access-policy.js';

const schema = Type.Object({
  command: Type.Union([
    Type.Literal('list'),
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
  { properties: { command: { enum: ['list', 'settings', 'interests', 'stop'] } } },
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

export function createPersonalAttentionTool(deps: {
  getConversationId: () => string | undefined;
  getConfig: () => Config | undefined;
  canReadTask?: (taskId: string) => boolean;
  onFollowUpUpdated?: (info: { followUpId: string; taskId: string; conversationId: string }) => void;
}): AgentTool<typeof schema, Record<string, unknown>> {
  return {
    name: 'personal_attention',
    label: 'Personal follow-up',
    description: 'Persist or inspect attention and one-shot conditional follow-ups in this personal conversation. For a one-shot conditional reminder tied to a Task pending item (e.g. "周五 16:00 如果还需要我定范围就告诉我" or "放工作台提醒我"), call command="follow" with oneShot=true (and taskId/waitId/destination/nextCheckLocal/validUntilLocal when known). Only claim a follow-up is active after a successful saved receipt; if clarification_needed or unsupported_condition is returned, ask the single clarifying question or explain the limitation honestly without claiming it was enabled. Use command="stop" (or "end" with id) to stop a follow-up.',
    parameters: schema,
    async execute(_toolId, input: Static<typeof schema>) {
      const conversationId = deps.getConversationId();
      const personal = conversationId ? getPersonalAgentByConversation(conversationId) : null;
      const config = deps.getConfig();
      if (!personal || !conversationId || !config) throw new Error('Personal attention is unavailable');
      if ((input.command === 'follow' || input.command === 'resume') && (!resolveUserContextSessionAccess(config, conversationId).userModel
        || config.userContext.userModel.writePolicy === 'deny')) throw new Error('Personal attention is unavailable');
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
                revision: thread.revision,
                strategy: strategyState(thread.id),
              };
            });
        const offset = input.offset ?? 0;
        return { content: [{ type: 'text', text: JSON.stringify(boundedPersonalResult({
          items: rows.slice(offset, offset + (input.limit ?? 10)), total: rows.length, offset })) }], details: {} };
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

      // Explicit stop branch for one-shot follow-ups (supports explicit id or context-disambiguated active follow-up)
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
            return {
              content: [{ type: 'text', text: JSON.stringify({ status: 'not_found', message: '当前没有正在进行的一次性条件跟进。' }) }],
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
