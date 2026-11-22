import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { createPersonalTaskTool } from '../../agent/tools/personal-task-tool.js';
import { ConfigSchema } from '../../config/schema.js';
import { PersonalPromptContext } from '../../personal-agent/prompt-context.js';
import { enqueuePersonalReply, PersonalReplyComposer } from '../../personal-agent/reply-composer.js';
import { personalAgentId, personalConversationId } from '../../personal-agent/repository.js';
import { personalRequestForTask } from '../../personal-agent/request-repository.js';
import * as resultReader from '../../personal-agent/result-reader.js';
import * as modelCalls from '../../providers/model-call.js';
import * as providers from '../../providers/index.js';
import { upsertConnectorConnection, upsertConnectorInstallation } from '../../storage/sqlite/connector-repository.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, getSqliteDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { claimNextSessionInput, finishSessionInputRun, insertSessionInput } from '../../storage/sqlite/session-input-repository.js';
import { appendTranscriptEntry, loadTranscriptRowsForSession } from '../../storage/sqlite/transcript-repository.js';
import { TaskAllocationRepository } from '../task-allocation-repository.js';
import { TaskAllocationDispatcher } from '../task-allocation-service.js';
import { TaskApplicationService } from '../task-application-service.js';
import { TaskCollaborationDelivery } from '../task-collaboration-delivery.js';
import { TaskCollaborationRepository } from '../task-collaboration-repository.js';
import { TaskConversationRepository } from '../task-conversation-repository.js';
import { taskConversationSummary } from '../task-conversation-summary.js';
import { assertTaskExecutorReady } from '../task-execution-capabilities.js';
import { clearTaskLiveActivity } from '../task-live-activity.js';
import { TaskRepository } from '../task-repository.js';
import { TaskResultDeliveryRepository } from '../task-result-delivery-repository.js';
import { TaskRunCoordinator } from '../task-run-coordinator.js';
import { buildTaskRunMessage } from '../task-run-dispatcher.js';
import { TaskRunRepository } from '../task-run-repository.js';

vi.mock('../../personal-agent/specialist-capabilities.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../personal-agent/specialist-capabilities.js')>(),
  getAvailablePersonalAgentTools: () => ['read_file', 'exec_command', 'web_search', 'xopc_tool_execute'],
  personalAgentModelAvailability: () => ({ available: true }),
}));

describe('Personal Agent fast-track execution, live visibility, and unified follow_up', () => {
  let stateDir: string;
  let ownerAgentId: string;
  let conversationId: string;
  const createdTaskIds: string[] = [];

  beforeEach(() => {
    vi.spyOn(resultReader, 'warmPersonalResult').mockImplementation(() => {});
    vi.spyOn(providers, 'resolveModel').mockReturnValue({ provider: 'openai', id: 'test', api: 'openai-responses' } as never);
    vi.spyOn(providers, 'isProviderConfiguredSync').mockReturnValue(true);
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-personal-fast-followup-'));
    vi.stubEnv('XOPC_STATE_DIR', stateDir);
    vi.stubEnv('XOPC_LOG_LEVEL', 'silent');
    resetXopcDatabaseSingletonForTest();
    seedTestDatabase(join(stateDir, 'xopc.db'));
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ownerAgentId = personalAgentId('local-owner');
    conversationId = personalConversationId('local-owner');
    const catalog = new AgentCatalogRepository();
    catalog.ensureInitialized();
    catalog.create({ id: ownerAgentId, profile: { name: 'Ada' } }, { ready: true });
    catalog.create({
      id: 'coder',
      profile: { name: 'Code Specialist', description: 'Code analysis and scripts' },
      specialistProfile: {
        version: 1,
        domains: ['code'],
        taskTypes: ['coding'],
        inputKinds: ['code'],
        outputKinds: ['report'],
        specialties: ['Code execution and repository scripts'],
        examples: [],
        limitations: [],
      },
    }, { ready: true });
    catalog.create({
      id: 'analyst',
      profile: { name: 'Data Specialist', description: 'CSV and spreadsheet analysis' },
      specialistProfile: {
        version: 1,
        domains: ['data'],
        taskTypes: ['data_analysis'],
        inputKinds: ['csv'],
        outputKinds: ['report'],
        specialties: ['CSV aggregation and charts'],
        examples: [],
        limitations: [],
      },
    }, { ready: true });
    catalog.create({
      id: 'mail-worker',
      profile: { name: 'Mail Specialist', description: 'Connected app mail reader' },
      toolAllowlist: ['tool_search', 'xopc_tool_describe', 'xopc_tool_execute'],
    }, { ready: true });
    if (!catalog.get('task-router')) {
      catalog.create({ id: 'task-router', purpose: 'task_dispatcher', toolAllowlist: [] }, { ready: true });
    }
    createConversation({ agentId: ownerAgentId, sourceChannel: 'webchat', customData: { personalAgent: true } }, '/tmp', conversationId);
  });

  afterEach(() => {
    for (const id of createdTaskIds.splice(0)) clearTaskLiveActivity(id);
    vi.restoreAllMocks();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    vi.unstubAllEnvs();
    rmSync(stateDir, { recursive: true, force: true });
  });

  function parseToolJson<T = Record<string, any>>(res: { content: Array<{ text?: string }> }): T {
    const raw = (res.content[0]?.text ?? '').trim();
    const boundary = raw.indexOf('\n}\n');
    const jsonSlice = boundary >= 0 ? raw.slice(0, boundary + 2) : raw;
    return JSON.parse(jsonSlice) as T;
  }

  function activateOriginInput(id: string, content: string): void {
    insertSessionInput({
      id,
      conversationId,
      clientMessageId: id,
      requestedDelivery: 'next',
      effectiveDelivery: 'next',
      status: 'queued',
      content,
      origin: { type: 'endpoint', endpointId: 'web-test' },
    });
    claimNextSessionInput(conversationId, `run:${id}`);
  }

  it('supports unified connected-app capabilities and composite submission via personal_task', async () => {
    upsertConnectorInstallation({
      id: 'composio-gmail-local-owner',
      connectorId: 'composio-gmail',
      principalId: 'local-owner',
      enabled: true,
      allowedAgentIds: [],
      maxScope: 'write',
      confirmationPolicy: 'writes',
      selectedAccountIds: null,
    });
    upsertConnectorConnection({
      id: 'gmail-work',
      connectorId: 'composio-gmail',
      provider: 'composio',
      principalId: 'local-owner',
      providerConnectionId: 'gmail-work',
      status: 'active',
      identity: { email: 'work@example.test' },
      isDefault: true,
      metadata: {},
    });

    const dispatchTaskRuns = vi.fn();
    const tool = createPersonalTaskTool({
      getCurrentConversationId: () => conversationId,
      getCurrentAgentId: () => ownerAgentId,
      dispatchTaskRuns,
    });

    const capabilities = await tool.execute('caps', { command: 'capabilities', query: 'gmail' });
    const parsedCaps = parseToolJson<{ items: Array<{ connectorId: string }> }>(capabilities);
    expect(parsedCaps.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ connectorId: 'composio-gmail' }),
    ]));

    activateOriginInput('mail-origin', '读取最近一周的重要邮件，并整理成 Markdown 报告保存。');
    const submitted = await tool.execute('submit-composite', {
      command: 'submit',
      connectorId: 'Gmail',
      objective: '读取最近一周的重要邮件并生成汇总报告',
      useOriginalRequest: true,
      timeRange: {
        from: '2026-11-15T00:00:00+08:00',
        to: '2026-11-22T00:00:00+08:00',
        timezone: 'Asia/Shanghai',
        expression: '最近一周',
      },
    });
    const receipt = parseToolJson(submitted);
    expect(receipt).toMatchObject({
      ok: true,
      connectorId: 'composio-gmail',
      state: 'queued',
    });
    expect(receipt.taskId).toBeTruthy();
    expect(receipt.requestId).toBeTruthy();
    createdTaskIds.push(receipt.taskId);
    expect(personalRequestForTask(receipt.taskId)?.requestId).toBe(receipt.requestId);
  });

  it('fast-tracks lightweight allocation with zero LLM calls, tracks live tool activity, and completes in a single pass', async () => {
    const modelSpy = vi.spyOn(modelCalls, 'completeWithResolvedCredentials');
    activateOriginInput('csv-input', '分析销售 CSV 数据并给出按月汇总趋势。');
    const tool = createPersonalTaskTool({
      getCurrentConversationId: () => conversationId,
      getCurrentAgentId: () => ownerAgentId,
      dispatchTaskRuns: vi.fn(),
    });

    const sub = await tool.execute('fast-submit', {
      command: 'submit',
      objective: '分析销售 CSV 数据并给出按月汇总趋势',
      useOriginalRequest: true,
    });
    const subJson = parseToolJson<{ taskId?: string; task?: { id: string } }>(sub);
    const taskId = (subJson.taskId ?? subJson.task?.id)!;
    createdTaskIds.push(taskId);

    const allocator = new TaskAllocationDispatcher({
      context: () => ({
        ownAgentId: ownerAgentId,
        getAgentToolAvailability: (_agentId, toolName) => ({
          condition: `tool:${toolName}`,
          state: 'verified',
          reasonCode: 'registered',
        }),
      }),
      wake: vi.fn(),
    });
    allocator.dispatch();
    await vi.waitFor(() => expect(new TaskAllocationRepository().summary(taskId)?.status).toBe('assigned'));
    allocator.stop();
    expect(modelSpy).not.toHaveBeenCalled();

    const allocation = new TaskAllocationRepository().summary(taskId);
    expect(allocation).toMatchObject({ status: 'assigned', selectedAgentId: 'analyst' });

    const runRepo = new TaskRunRepository();
    const claimed = runRepo.claimNext({ owner: 'worker-slot', leaseMs: 60_000, executorKind: 'agent' })!;
    const workerSession = createConversation({ agentId: 'analyst' }, '/tmp');
    new TaskConversationRepository().activateExecutionSession({
      taskId,
      runId: claimed.id,
      agentId: 'analyst',
      conversationId: workerSession.key,
    });

    const coordinator = TaskRunCoordinator.start({
      runId: claimed.id,
      context: {
        runId: claimed.id,
        taskId,
        conversationId: workerSession.key,
        agentId: 'analyst',
        channel: 'webchat',
        origin: 'task',
        triggerKind: 'user',
      },
      fallbackObjective: '分析销售 CSV 数据并给出按月汇总趋势',
    })!;
    coordinator.captureToolStart('exec_command');
    expect(taskConversationSummary(taskId, conversationId)?.liveActivity).toMatchObject({
      stage: 'tool_running',
      toolName: 'exec_command',
    });
    const promptSnapshot = new PersonalPromptContext().build(ConfigSchema.parse({}), conversationId)!;
    expect(promptSnapshot).toContain('exec_command');

    coordinator.captureToolEnd('exec_command');
    coordinator.captureResponding();
    expect(taskConversationSummary(taskId, conversationId)?.liveActivity?.stage).toBe('responding');

    coordinator.finalize({
      status: 'succeeded',
      summary: '结论：10 月销售额环比增长 18%，11 月保持稳定。',
      assistantText: '结论：10 月销售额环比增长 18%，11 月保持稳定。',
    });

    expect(taskConversationSummary(taskId, conversationId)?.liveActivity).toBeUndefined();
    const updatedTask = new TaskRepository().require(taskId);
    expect(updatedTask.phase).toBe('closed');
    expect(updatedTask.resolution).toBe('done');
    expect(runRepo.require(claimed.id).status).toBe('succeeded');
    expect(modelSpy).not.toHaveBeenCalled();

    const deliveries = new TaskResultDeliveryRepository().pending(10).map(row => JSON.parse(row.payload_json));
    expect(deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        taskId,
        taskRunId: claimed.id,
        conversationId,
        text: expect.stringContaining('10 月销售额环比增长 18%'),
      }),
    ]));
  });

  it('handles unified follow_up across allocating, running, waiting, and completed warm-session states', async () => {
    const dispatchTaskRuns = vi.fn();
    const tool = createPersonalTaskTool({
      getCurrentConversationId: () => conversationId,
      getCurrentAgentId: () => ownerAgentId,
      dispatchTaskRuns,
    });

    // 1. Allocating state: updates brief & resets blocked allocation
    activateOriginInput('init-1', '编写一段仓库日志统计脚本并总结异常。');
    const createdRes = await tool.execute('sub-1', {
      command: 'submit',
      objective: '日志统计与异常汇总',
      useOriginalRequest: true,
    });
    const createdJson = parseToolJson<{ taskId?: string; task?: { id: string } }>(createdRes);
    const taskId = (createdJson.taskId ?? createdJson.task?.id)!;
    createdTaskIds.push(taskId);
    getSqliteDatabase()
      .prepare("UPDATE task_allocations SET status = 'blocked', reason_code = 'router_question' WHERE task_id = ?")
      .run(taskId);

    activateOriginInput('fu-alloc', '日志目录在 /var/log/app，按小时统计。');
    const allocFollowUp = parseToolJson(await tool.execute('fu-1', {
      command: 'follow_up',
      taskId,
      instruction: '日志目录在 /var/log/app，按小时统计。',
    }));
    expect(allocFollowUp).toMatchObject({ ok: true, taskId, action: 'updated_allocation' });
    expect(new TaskAllocationRepository().summary(taskId)?.status).toBe('pending');
    expect(new TaskRepository().require(taskId).body).toContain('/var/log/app');

    // Allocate & start worker session
    const allocator = new TaskAllocationDispatcher({
      context: () => ({
        ownAgentId: ownerAgentId,
        getAgentToolAvailability: (_id, name) => ({ condition: `tool:${name}`, state: 'verified', reasonCode: 'registered' }),
      }),
      wake: vi.fn(),
    });
    allocator.dispatch();
    await vi.waitFor(() => expect(new TaskAllocationRepository().summary(taskId)?.status).toBe('assigned'));
    allocator.stop();

    const runRepo = new TaskRunRepository();
    const run1Claimed = runRepo.claimNext({ owner: 'slot-1', leaseMs: 60_000, executorKind: 'agent' })!;
    const assignedExecutorId = typeof run1Claimed.executorRef.agentId === 'string' ? run1Claimed.executorRef.agentId : 'coder';
    const warmWorker = createConversation({ agentId: assignedExecutorId }, '/tmp');
    appendTranscriptEntry(warmWorker.key, {
      role: 'assistant',
      content: [{ type: 'text', text: 'Initial log scan cached.' }],
      timestamp: Date.now(),
    });
    new TaskConversationRepository().activateExecutionSession({
      taskId,
      runId: run1Claimed.id,
      agentId: assignedExecutorId,
      conversationId: warmWorker.key,
    });
    const coord1 = TaskRunCoordinator.start({
      runId: run1Claimed.id,
      context: {
        runId: run1Claimed.id,
        taskId,
        conversationId: warmWorker.key,
        agentId: assignedExecutorId,
        channel: 'webchat',
        origin: 'task',
        triggerKind: 'user',
      },
      fallbackObjective: '日志统计与异常汇总',
    })!;
    const run1 = runRepo.require(run1Claimed.id);

    // 2. Running state: steers active worker
    activateOriginInput('fu-run', '顺便排除 healthcheck 请求。');
    const runningFollowUp = parseToolJson(await tool.execute('fu-2', {
      command: 'follow_up',
      taskId,
      instruction: '顺便排除 healthcheck 请求。',
    }));
    expect(runningFollowUp).toMatchObject({ ok: true, taskId, action: 'steered_running' });
    const deliveredSteer = vi.fn(async () => true);
    expect(await new TaskCollaborationDelivery().drain(deliveredSteer)).toBe(1);
    expect(deliveredSteer).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: warmWorker.key,
      delivery: 'steer',
      content: expect.stringContaining('顺便排除 healthcheck 请求'),
    }));

    // 3. Waiting state: auto-resolves worker question without questionId and clears waiting lease
    const board = new TaskCollaborationRepository();
    const question = board.append({
      taskId,
      taskRunId: run1.id,
      authorKind: 'worker_agent',
      authorId: 'coder',
      kind: 'question',
      body: '是否包含归档的 .gz 日志？',
      idempotencyKey: 'q-gz',
    });
    const app = new TaskApplicationService();
    const taskBeforeWait = new TaskRepository().require(taskId);
    const addedWait = app.execute({
      taskId,
      expectedVersion: taskBeforeWait.version,
      idempotencyKey: 'wait-q-gz',
      command: {
        type: 'add_wait',
        wait: {
          taskRunId: run1.id,
          kind: 'user_input',
          reason: question.body,
          condition: { collaborationEntryId: question.id },
        },
      },
    });
    expect(addedWait.ok).toBe(true);
    expect(runRepo.require(run1.id).status).toBe('waiting');
    expect(runRepo.require(run1.id).leaseOwner).toBeUndefined();

    activateOriginInput('fu-wait', '不需要 .gz，只看当天活跃日志。');
    const waitingFollowUp = parseToolJson(await tool.execute('fu-3', {
      command: 'follow_up',
      taskId,
      instruction: '不需要 .gz，只看当天活跃日志。',
    }));
    expect(waitingFollowUp).toMatchObject({ ok: true, taskId, action: 'unblocked_and_resumed', runId: run1.id });
    expect(runRepo.listActiveWaits(taskId)).toHaveLength(0);

    // Claim resumed run1 and complete it
    const resumedClaim = runRepo.claimNext({ owner: 'slot-1', leaseMs: 60_000, executorKind: 'agent' })!;
    expect(resumedClaim.id).toBe(run1.id);
    runRepo.setStatus({
      runId: resumedClaim.id,
      expectedVersion: resumedClaim.version,
      from: ['waiting'],
      to: 'running',
    });
    expect(await new TaskCollaborationDelivery().drain(async () => true)).toBeGreaterThanOrEqual(0);
    coord1.finalize({
      status: 'succeeded',
      summary: '已完成当天活跃日志统计：共 3 类 500 错误。',
      assistantText: '已完成当天活跃日志统计：共 3 类 500 错误。',
    });
    expect(new TaskRepository().require(taskId).phase).toBe('closed');
    expect(new TaskRepository().require(taskId).resolution).toBe('done');

    // 4. Completed state: Warm Session Continuation on the SAME worker conversationId!
    const epochBefore = new TaskConversationRepository().getState(taskId)?.assignmentEpoch;
    activateOriginInput('fu-done', '再按接口路径把这 3 类 500 错误做个 Top 5 表格。');
    const warmFollowUp = parseToolJson(await tool.execute('fu-4', {
      command: 'follow_up',
      taskId,
      instruction: '再按接口路径把这 3 类 500 错误做个 Top 5 表格。',
    }));
    expect(warmFollowUp).toMatchObject({
      ok: true,
      taskId,
      action: 'continued_warm_session',
      operationalState: 'queued',
    });
    expect(warmFollowUp.runId).toBeTruthy();
    expect(warmFollowUp.runId).not.toBe(run1.id);

    const run2 = runRepo.require(warmFollowUp.runId);
    expect(run2.conversationId).toBe(warmWorker.key);
    expect(new TaskConversationRepository().getState(taskId)).toMatchObject({
      activeConversationId: warmWorker.key,
      assignmentEpoch: (epochBefore ?? 0) + 1,
    });
    expect(new TaskConversationRepository().resolveActiveExecutionSession(warmWorker.key)).toMatchObject({
      taskId,
      runId: run2.id,
      conversationId: warmWorker.key,
    });
    // Preserves warm worker session transcript and passes capability preflight
    expect(loadTranscriptRowsForSession(warmWorker.key).length).toBeGreaterThan(0);
    const assignedAgentId = typeof run2.executorRef.agentId === 'string' ? run2.executorRef.agentId : assignedExecutorId;
    expect(() => assertTaskExecutorReady(taskId, conversationId, assignedAgentId, {
      ownAgentId: ownerAgentId,
      getAgentToolAvailability: (_id, name) => ({ condition: `tool:${name}`, state: 'verified', reasonCode: 'registered' }),
    })).not.toThrow();

    const promptMessage = buildTaskRunMessage(
      new TaskRepository().require(taskId).contract!.objective,
      run2.trigger,
      new TaskRepository().require(taskId).body,
      taskId,
    );
    expect(promptMessage).toContain(`<task_follow_up task_id="${taskId}">`);
    expect(promptMessage).toContain('Top 5 表格');
  });

  it('does not abort active reply composition at 5s when idle, but falls back after 5s when busy', async () => {
    activateOriginInput('reply-origin', '请总结三个季度的核心指标。');
    finishSessionInputRun(conversationId, 'run:reply-origin', 'completed');

    const tool = createPersonalTaskTool({
      getCurrentConversationId: () => conversationId,
      getCurrentAgentId: () => ownerAgentId,
      dispatchTaskRuns: vi.fn(),
    });
    const created = await tool.execute('reply-create', {
      command: 'create',
      agentId: 'analyst',
      objective: '总结报告',
      description: '汇总三个季度核心指标。',
    });
    const taskId = parseToolJson<{ task: { id: string } }>(created).task.id;
    createdTaskIds.push(taskId);
    const run = new TaskRunRepository().getActiveRoot(taskId)!;
    const worker = createConversation({ agentId: 'analyst' }, '/tmp');
    new TaskConversationRepository().activateExecutionSession({
      taskId,
      runId: run.id,
      agentId: 'analyst',
      conversationId: worker.key,
    });
    const coord = TaskRunCoordinator.start({
      runId: run.id,
      context: {
        runId: run.id,
        taskId,
        conversationId: worker.key,
        agentId: 'analyst',
        channel: 'webchat',
        origin: 'task',
        triggerKind: 'user',
      },
      fallbackObjective: '总结报告',
    })!;
    coord.finalize({
      status: 'succeeded',
      summary: '总结：核心指标全部达标。',
      assistantText: '总结：核心指标全部达标。\n\n包含三个季度的完整对比明细与推导过程。',
    });

    const row = new TaskResultDeliveryRepository().pending(10).find(r => JSON.parse(r.payload_json).taskRunId === run.id)!;
    expect(row).toBeTruthy();
    const deliveryPayload = JSON.parse(row.payload_json);
    enqueuePersonalReply({
      delivery: deliveryPayload,
      report: '总结：核心指标全部达标。\n\n包含三个季度的完整对比明细与推导过程。',
      objective: '总结报告',
    });
    // Simulate in-flight reply composition that started 6.5s ago (> 5s busy threshold, < 12s timeoutMs)
    getSqliteDatabase()
      .prepare(`UPDATE task_result_deliveries
        SET status = 'delivered', reply_status = 'generating',
            reply_lease_token = 'active-lease', reply_lease_until = ?, created_at = ?
        WHERE delivery_id = ?`)
      .run(Date.now() + 10_000, Date.now() - 6_500, row.delivery_id);

    const composer = new PersonalReplyComposer(async () => '总结：核心指标全部达标。', 12_000);
    // 1. When conversation is idle & available, 6.5s in-flight composition must NOT be aborted!
    await composer.drain(vi.fn(), () => true);
    const stillGenerating = getSqliteDatabase()
      .prepare('SELECT reply_status FROM task_result_deliveries WHERE delivery_id = ?')
      .get(row.delivery_id) as { reply_status: string };
    expect(stillGenerating.reply_status).toBe('generating');

    // 2. When conversation becomes unavailable/busy (>5s), busy_fallback immediately rescues delivery!
    await composer.drain(vi.fn(), () => false);
    const rescued = getSqliteDatabase()
      .prepare('SELECT reply_status, reply_text FROM task_result_deliveries WHERE delivery_id = ?')
      .get(row.delivery_id) as { reply_status: string; reply_text: string };
    expect(rescued.reply_status).toBe('delivered');
    expect(rescued.reply_text).toContain('总结：核心指标全部达标');
  });
});
