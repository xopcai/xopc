import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../config/schema.js';
import { seedTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { LocalWorktreeManager } from '../../../execution-environments/local-worktree-manager.js';
import { ProjectStore } from '../../../projects/project-store.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { TaskRunRepository } from '../../../tasks/task-run-repository.js';
import { TaskApplicationService } from '../../../tasks/task-application-service.js';
import { ScenePreferenceService } from '../../preferences.js';
import { TaskSourceRegistry, type TaskFollowUpInput } from '../contracts.js';
import { TaskFollowUpService } from '../service.js';
import { VerificationTerminationUnknownError } from '../../../agent/commands/approved-verification.js';

describe('Source-driven task follow-up', () => {
  let directory: string;
  let repository: string;
  let service: TaskFollowUpService;
  let input: TaskFollowUpInput;
  let conversationId: string;
  let revision = 1;
  const principal = { ownerId: 'local-owner', workspaceId: 'test' };
  const execute = vi.fn();
  const read = vi.fn();
  const listAccounts = vi.fn();
  const verify = vi.fn();
  const sources = () => new TaskSourceRegistry([{ id: 'fixture_thread', label: 'Fixture source',
    normalize: reference => reference, authorized: () => listAccounts().length > 0,
    accountIds: () => ['account'], listAccounts, read }]);
  const config = ConfigSchema.parse({});
  const git = (args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-task-follow-up-'));
    repository = join(directory, 'repository'); mkdirSync(repository);
    git(['init', '-b', 'main']); git(['config', 'user.email', 'test@example.invalid']); git(['config', 'user.name', 'Test']);
    writeFileSync(join(repository, 'app.js'), 'export const value = 1;\n');
    git(['add', 'app.js']); git(['commit', '-m', 'fixture']);
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'state.db') });
    seedTestAgentCatalog({ defaults: {
      models: { chat: { primary: 'test/model', fallbacks: [] }, intents: {} },
      skills: { mode: 'selected', include: [] }, tools: {}, workflows: {},
      runtime: { commandIsolation: { mode: 'docker', image: `test@sha256:${'a'.repeat(64)}` } },
    } });
    const project = new ProjectStore().create({ name: 'Development fixture', workspaceRoot: repository });
    conversationId = createConversation({ agentId: 'main', sourceChannel: 'webchat', sourceChatId: 'test' }).key;
    revision = 1;
    listAccounts.mockReset().mockReturnValue([{ id: 'account', label: 'Test source' }]);
    read.mockReset().mockImplementation(async () => ({ revision: String(revision), text: `Requirement ${revision}`, observedAt: Date.now() }));
    execute.mockReset().mockImplementation(async ({ workspace, guard }) => {
      guard(); writeFileSync(join(workspace, 'app.js'), 'export const value = 2;\n');
      return { summary: 'Implemented', needsUser: false, continueAutomatically: false, remainingWork: [] };
    });
    verify.mockReset().mockResolvedValue({ passed: true, output: '1 test passed' });
    service = new TaskFollowUpService(getSqliteDatabase(), { config: () => config, sources: sources(), stateDir: directory, executor: { execute }, verify,
      worktrees: new LocalWorktreeManager({ stateDir: directory }) });
    input = { source: { provider: 'fixture_thread', reference: { id: 'discussion' } },
      projectId: project.id, goal: 'Fix value', instruction: '', resource: 'worktree',
      capabilities: ['workspace.read', 'workspace.write', 'verification.run'], verificationCommand: 'node --test' };
  });
  afterEach(async () => {
    await service.stop(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true });
  });
  async function run(id: string) {
    const item = service.get(principal, id);
    const run = new TaskRunRepository().getActiveRoot(item.task.id)!;
    await service.executeTask(run.id, conversationId);
    return service.get(principal, id);
  }
  function due() { getSqliteDatabase().prepare('UPDATE scene_task_bindings SET next_poll_at = 0').run(); }

  it('rejects unknown source providers and resource grants without a resource', async () => {
    await expect(service.create(principal, { ...input, source: { provider: 'missing', reference: {} } })).rejects.toThrow('unavailable');
    await expect(service.create(principal, { ...input, resource: 'none' })).rejects.toThrow('resource');
  });

  it('deduplicates thread delegation, binds a named worktree, and verifies the latest revision', async () => {
    const created = await service.create(principal, input);
    expect((await service.create(principal, input)).task.id).toBe(created.task.id);
    const done = await run(created.activation.id);
    expect(done.lastError).toBeNull();
    expect(done.processedRevision).toBe(1);
    expect(done.task.phase).toBe('review');
    expect(done.environment?.branchRef).toBe(`xopc/task-${done.task.id}`);
    expect(done.receipt?.verification.status).toBe('passed');
    expect(readFileSync(join(repository, 'app.js'), 'utf8')).toContain('value = 1');
    expect(verify).toHaveBeenCalledOnce();
    await service.tick();
    expect(new TaskRunRepository().listByTask(done.task.id)).toHaveLength(1);
  });

  it('updates the same task and worktree when the thread changes', async () => {
    const created = await service.create(principal, input);
    const first = await run(created.activation.id);
    revision = 2; due(); await service.tick();
    const second = await run(created.activation.id);
    expect(second.task.id).toBe(first.task.id);
    expect(second.environment?.id).toBe(first.environment?.id);
    expect(second.processedRevision).toBe(2);
    expect(second.task.latestContractVersion).toBe(2);
    expect(execute).toHaveBeenCalledTimes(2);
  }, 30_000); // Multiple real Git operations and fsyncs may contend with full-suite workers.

  it('deduplicates concurrent delegation after asynchronous source checks', async () => {
    const items = await Promise.all([service.create(principal, input), service.create(principal, input)]);
    expect(items[0].task.id).toBe(items[1].task.id);
    expect(service.list(principal)).toHaveLength(1);
    expect(new TaskRunRepository().listByTask(items[0].task.id)).toHaveLength(1);
  });

  it('treats capability ordering in migrated bindings as the same delegation', async () => {
    const created = await service.create(principal, input);
    getSqliteDatabase().prepare('UPDATE scene_task_bindings SET input_json = ? WHERE activation_id = ?')
      .run(JSON.stringify({ ...input, capabilities: [...input.capabilities].reverse() }), created.activation.id);
    expect((await service.create(principal, input)).task.id).toBe(created.task.id);
  });

  it('does not infer an immediate retry from remaining work outside current authority', async () => {
    execute.mockResolvedValue({ summary: 'Document prepared; verification is unavailable', needsUser: false,
      continueAutomatically: false, remainingWork: ['Verification requires a separately approved environment'] });
    const created = await service.create(principal, { ...input, capabilities: ['workspace.read', 'workspace.write'], verificationCommand: undefined });
    const result = await run(created.activation.id);
    due(); await service.tick();
    expect(result.receipt?.needsUser).toBe(false);
    expect(new TaskRunRepository().listByTask(result.task.id)).toHaveLength(1);
    expect(new TaskRunRepository().listActiveWaits(result.task.id)).toHaveLength(0);
  });

  it('continues explicitly requested work without a verification tool and stops within budget', async () => {
    execute.mockResolvedValue({ summary: 'Partially updated', needsUser: false,
      continueAutomatically: true, remainingWork: ['Finish the remaining section'] });
    const created = await service.create(principal, { ...input, capabilities: ['workspace.read', 'workspace.write'], verificationCommand: undefined });
    await run(created.activation.id);
    await service.tick(); await run(created.activation.id);
    await service.tick(); const result = await run(created.activation.id);
    await service.tick();
    expect(execute).toHaveBeenCalledTimes(3);
    expect(result.receipt?.needsUser).toBe(true);
    expect(new TaskRunRepository().listActiveWaits(result.task.id)).toHaveLength(1);
    expect(verify).not.toHaveBeenCalled();
  });

  it('does not certify code changed by a human during verification', async () => {
    verify.mockImplementation(async ({ workspace }) => {
      writeFileSync(join(workspace, 'app.js'), 'export const humanChange = 3;\n');
      return { passed: true, output: 'old tests passed' };
    });
    const created = await service.create(principal, input);
    const result = await run(created.activation.id);
    expect(result.processedRevision).toBe(0);
    expect(result.lastError).toContain('Workspace changed');
    expect(readFileSync(join(result.environment!.rootPath, 'app.js'), 'utf8')).toContain('humanChange');
  });

  it('retains the writer fence when container termination cannot be confirmed', async () => {
    verify.mockRejectedValue(new VerificationTerminationUnknownError('termination unknown'));
    const created = await service.create(principal, input);
    const result = await run(created.activation.id);
    expect(result.processedRevision).toBe(0);
    expect(result.activation.status).toBe('needs_setup');
    const binding = getSqliteDatabase().prepare('SELECT executing_run_id FROM scene_task_bindings WHERE activation_id = ?').get(created.activation.id);
    expect(binding!.executing_run_id).toBeTruthy();
  });

  it('automatically resumes the same task after the user answers a blocking question', async () => {
    execute.mockResolvedValueOnce({ summary: 'Which behavior is intended?', needsUser: true, continueAutomatically: false, remainingWork: ['Choose behavior'] });
    const created = await service.create(principal, input);
    const waiting = await run(created.activation.id);
    const wait = new TaskRunRepository().listActiveWaits(waiting.task.id)[0];
    expect(wait.kind).toBe('user_input');
    const answer = new TaskApplicationService().execute({ taskId: waiting.task.id, expectedVersion: waiting.task.version,
      idempotencyKey: 'answer-fixture', actor: { kind: 'user', id: principal.ownerId },
      command: { type: 'resolve_wait', waitId: wait.id, resolution: { kind: 'user_answer', answer: 'Use value 2' } } });
    expect(answer.ok).toBe(true);
    await service.tick();
    const resumed = await run(created.activation.id);
    expect(resumed.task.id).toBe(waiting.task.id);
    expect(resumed.processedRevision).toBe(1);
    expect(execute.mock.calls.at(-1)![0].goal).toContain('Use value 2');
  });

  it('does not certify an old result if discussion changes before verification', async () => {
    execute.mockImplementation(async () => { revision = 2; return { summary: 'Old result', needsUser: false, continueAutomatically: false, remainingWork: [] }; });
    const created = await service.create(principal, input);
    const result = await run(created.activation.id);
    expect(result.processedRevision).toBe(0);
    expect(result.observedRevision).toBe(2);
    expect(result.receipt?.status).toBe('cancelled');
    expect(result.receipt?.verification.status).toBe('unverified');
  });

  it('enforces principal isolation and refuses to silently reuse a different project or goal', async () => {
    const created = await service.create(principal, input);
    expect(() => service.get({ ...principal, ownerId: 'someone-else' }, created.activation.id)).toThrow();
    await expect(service.create(principal, { ...input, goal: 'Different goal' })).rejects.toThrow('already delegated');
  });

  it('stops at the next tool boundary when the scene is paused', async () => {
    let ready!: () => void;
    let release!: () => void;
    const reached = new Promise<void>(resolve => { ready = resolve; });
    execute.mockImplementation(async ({ guard }) => { ready(); await new Promise<void>(resolve => { release = resolve; }); guard();
      return { summary: 'Must not certify', needsUser: false, continueAutomatically: false, remainingWork: [] }; });
    const created = await service.create(principal, input);
    const pending = run(created.activation.id); await reached;
    const pause = service.transition(principal, created.activation.id, created.activation.revision, 'paused');
    release(); await pause; await pending;
    expect(service.get(principal, created.activation.id).activation.status).toBe('paused');
    expect(verify).not.toHaveBeenCalled();
  });

  it('permits file editing without Docker, while verification is an independent grant', async () => {
    await service.stop();
    service = new TaskFollowUpService(getSqliteDatabase(), { config: () => ConfigSchema.parse({}),
      sources: sources(), executor: { execute }, stateDir: directory, worktrees: new LocalWorktreeManager({ stateDir: directory }) });
    expect((await service.preflight(principal, input)).missing).toContain('verification_backend_unavailable');
    const editOnly = { ...input, capabilities: ['workspace.read', 'workspace.write'], verificationCommand: undefined };
    expect((await service.preflight(principal, editOnly)).ready).toBe(true);
    const created = await service.create(principal, editOnly);
    const done = await run(created.activation.id);
    expect(done.processedRevision).toBe(1);
    expect(done.receipt?.verification.status).toBe('unverified');
    expect(done.receipt?.needsUser).toBe(false);
    expect(new TaskRunRepository().listActiveWaits(done.task.id)).toHaveLength(0);
    expect(readFileSync(join(done.environment!.rootPath, 'app.js'), 'utf8')).toContain('value = 2');
    expect(verify).not.toHaveBeenCalled();
  });

  it('changes instructions and file authority without creating another task or resource', async () => {
    execute.mockResolvedValue({ summary: 'Inspected', needsUser: false, continueAutomatically: false, remainingWork: [] });
    const created = await service.create(principal, { ...input, capabilities: ['workspace.read'], verificationCommand: undefined });
    const first = await run(created.activation.id);
    const paused = await service.transition(principal, first.activation.id, first.activation.revision, 'paused');
    const configured = await service.configure(principal, first.activation.id, paused.activation.revision, {
      ...paused.input, instruction: 'Update the implementation', capabilities: ['workspace.read', 'workspace.write'],
    });
    expect(configured.task.id).toBe(first.task.id);
    expect(configured.environment!.id).toBe(first.environment!.id);
    expect(configured.activation.status).toBe('paused');
    expect(configured.input.instruction).toBe('Update the implementation');
    await expect(service.configure(principal, first.activation.id, configured.activation.revision, {
      ...configured.input, resource: 'artifacts',
    })).rejects.toThrow('identity');
  });

  it('associates an existing branch without changing checkout, files, or execution ownership', async () => {
    git(['branch', 'old-fix']);
    const created = await service.create(principal, input);
    const inventory = await service.branches.list(principal, input.projectId!);
    const branch = inventory.branches.find(item => item.ref === 'refs/heads/old-fix')!;
    expect(branch.association).toBe('unassociated');
    await service.branches.associate(principal, { projectId: input.projectId!, taskId: created.task.id, branchRef: branch.ref, expectedSha: branch.sha });
    expect((await service.branches.list(principal, input.projectId!)).branches.find(item => item.ref === branch.ref)?.taskId).toBe(created.task.id);
    expect(git(['branch', '--show-current']).trim()).toBe('main');
    expect(service.get(principal, created.activation.id).environment).toBeUndefined();
    await expect(service.branches.associate(principal, { projectId: input.projectId!, taskId: created.task.id, branchRef: branch.ref, expectedSha: '0'.repeat(40) })).rejects.toThrow('changed');
  });

  it('withdraws permission without invoking the agent or claiming success', async () => {
    const created = await service.create(principal, input);
    listAccounts.mockReturnValue([]); await service.tick();
    const result = service.get(principal, created.activation.id);
    expect(result.activation.status).toBe('needs_setup');
    expect(result.lastError).toContain('permission');
    expect(execute).not.toHaveBeenCalled();
  });

  it('blocks stale contract completion and preserves the newer user contract', async () => {
    const created = await service.create(principal, input);
    execute.mockImplementation(async () => {
      const task = service.get(principal, created.activation.id).task;
      new TaskApplicationService().execute({ taskId: task.id, expectedVersion: task.version, idempotencyKey: 'user-change',
        command: { type: 'revise_contract', contract: { ...task.contract!, objective: 'Changed by user' } } });
      return { summary: 'Old result', needsUser: false, continueAutomatically: false, remainingWork: [] };
    });
    const result = await run(created.activation.id);
    expect(result.processedRevision).toBe(0);
    expect(result.task.contract?.objective).toBe('Changed by user');
    expect(result.receipt?.status).toBe('cancelled');
    revision = 2; due(); await service.tick();
    expect(service.get(principal, created.activation.id).task.contract?.objective).toBe('Changed by user');
  });

  it('keeps quiet on unchanged polls and respects global pause', async () => {
    const created = await service.create(principal, input); await run(created.activation.id);
    const count = getSqliteDatabase().prepare("SELECT count(*) AS n FROM domain_outbox WHERE event_type = 'task.attention_required.v2'").get()!.n;
    due(); await service.tick(); due(); await service.tick();
    expect(execute).toHaveBeenCalledOnce();
    expect(getSqliteDatabase().prepare("SELECT count(*) AS n FROM domain_outbox WHERE event_type = 'task.attention_required.v2'").get()!.n).toBe(count);
    new ScenePreferenceService(getSqliteDatabase()).update(principal, { expectedRevision: 0, checksPaused: true });
    const calls = read.mock.calls.length; revision = 2; due(); await service.tick();
    expect(read).toHaveBeenCalledTimes(calls);
    expect(service.allowsTaskNotification(created.task.id)).toBe(true);
    new ScenePreferenceService(getSqliteDatabase()).update(principal, { expectedRevision: 1, notificationsMuted: true });
    expect(service.allowsTaskNotification(created.task.id)).toBe(false);
  });

  it('continues incomplete work within a bounded budget, then requests a concrete review', async () => {
    verify.mockResolvedValue({ passed: false, output: 'Test failed' });
    const created = await service.create(principal, input);
    let result = await run(created.activation.id);
    expect(result.processedRevision).toBe(1);
    expect(result.receipt?.needsUser).toBe(false);
    await service.tick(); result = await run(created.activation.id);
    expect(result.receipt?.needsUser).toBe(false);
    await service.tick(); result = await run(created.activation.id);
    expect(result.receipt?.needsUser).toBe(true);
    expect(new TaskRunRepository().listActiveWaits(result.task.id)).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('continues a failed verification through the same Task dispatch path', async () => {
    verify.mockResolvedValueOnce({ passed: false, output: 'Expected value 2' }).mockResolvedValueOnce({ passed: true, output: 'Passed after repair' });
    const created = await service.create(principal, input);
    const first = await run(created.activation.id);
    await service.tick(); const second = await run(created.activation.id);
    expect(second.task.id).toBe(first.task.id);
    expect(second.environment!.id).toBe(first.environment!.id);
    expect(second.processedRevision).toBe(1);
    expect(second.receipt?.verification.status).toBe('passed');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('runs a non-coding document task without a project, Git, or verification backend', async () => {
    execute.mockImplementation(async ({ workspace, instruction, evidence, guard }) => {
      guard(); writeFileSync(join(workspace, 'decisions.md'), instruction + '\\n' + evidence);
      return { summary: 'Document updated', needsUser: false, continueAutomatically: false, remainingWork: [] };
    });
    const created = await service.create(principal, { source: input.source, goal: 'Maintain the decision log',
      instruction: 'Record decisions and open questions', resource: 'artifacts', capabilities: ['workspace.read', 'workspace.write'] });
    const first = await run(created.activation.id);
    expect(first.environment).toBeUndefined();
    expect(first.task.projectId).toBeUndefined();
    expect(readFileSync(join(first.artifactPath!, 'decisions.md'), 'utf8')).toContain('Requirement 1');
    revision = 2; due(); await service.tick();
    const second = await run(created.activation.id);
    expect(second.task.id).toBe(first.task.id);
    expect(second.artifactPath).toBe(first.artifactPath);
    expect(readFileSync(join(second.artifactPath!, 'decisions.md'), 'utf8')).toContain('Requirement 2');
    expect(second.processedRevision).toBe(2);
    expect(second.receipt?.verification.status).toBe('unverified');
    expect(verify).not.toHaveBeenCalled();
  });

  it('runs a different source adapter and a no-resource task through the same coordinator', async () => {
    await service.stop();
    service = new TaskFollowUpService(getSqliteDatabase(), { config: () => ConfigSchema.parse({}), stateDir: directory,
      sources: new TaskSourceRegistry([{ id: 'mail_fixture', label: 'Mail fixture', normalize: ref => ref, accountIds: () => [],
        authorized: () => true, read: async () => ({ revision: String(revision), text: 'Meeting moved to Friday', observedAt: Date.now() }) }]),
      executor: { execute: async args => {
        expect(args.capabilities).toEqual([]); expect(args.evidence).toContain('Friday');
        return { summary: 'Friday confirmed', needsUser: false, continueAutomatically: false, remainingWork: [] };
      } } });
    const created = await service.create(principal, { source: { provider: 'mail_fixture', reference: { id: 'mail' } }, goal: 'Track meeting decisions' });
    const done = await run(created.activation.id);
    expect(done.environment).toBeUndefined();
    expect(done.artifactPath).toBeUndefined();
    expect(done.processedRevision).toBe(1);
  });

  it('retains an unknown writer on restart until termination is verified', async () => {
    const created = await service.create(principal, input);
    const runId = created.run!.id;
    getSqliteDatabase().prepare('UPDATE scene_task_bindings SET executing_run_id = ? WHERE activation_id = ?').run(runId, created.activation.id);
    await service.stop();
    const stopVerification = vi.fn().mockRejectedValue(new Error('Docker unavailable'));
    service = new TaskFollowUpService(getSqliteDatabase(), { config: () => config, sources: sources(), stateDir: directory, executor: { execute }, verify, stopVerification,
      worktrees: new LocalWorktreeManager({ stateDir: directory }) });
    await service.tick();
    let item = service.get(principal, created.activation.id);
    expect(item.activation.status).toBe('needs_setup');
    await expect(service.transition(principal, item.activation.id, item.activation.revision, 'active')).rejects.toThrow('execution_termination_unknown');
    expect(execute).not.toHaveBeenCalled();
    stopVerification.mockResolvedValue(undefined);
    item = await service.transition(principal, item.activation.id, item.activation.revision, 'active');
    expect(item.activation.status).toBe('active');
    expect(new TaskRunRepository().get(runId)?.status).toBe('cancelled');
  });
});
