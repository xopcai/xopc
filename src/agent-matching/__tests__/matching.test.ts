import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskCreateRequestSchema, SpecialistProfileSchema, normalizeSpecialistRequirements } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { resolveEffectiveAgentConfig } from '../../agent-config/index.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { deleteSessionRecord } from '../../storage/sqlite/session-repository.js';
import { TaskApplicationService } from '../../tasks/task-application-service.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { defineTaskContract } from '../../tasks/task-contract-definition.js';
import { AgentSelectionRepository } from '../selection-repository.js';
import { createSelectedTask } from '../delegation-service.js';
import { assessSpecialist, matchSpecialists, type MatchingContext } from '../service.js';

vi.mock('../../personal-agent/specialist-capabilities.js', () => ({
  getAvailablePersonalAgentTools: (config: { toolAllowlist?: string[]; tools: Record<string, { mode: string }> }) =>
    (config.toolAllowlist ?? ['read_file', 'exec_command']).filter(tool => config.tools[tool]?.mode !== 'deny'),
  personalAgentModelAvailability: () => ({ available: true }),
}));

const profile = SpecialistProfileSchema.parse({ version: 1, domains: ['data'], taskTypes: ['data_analysis'],
  inputKinds: ['csv'], outputKinds: ['report'], specialties: ['Reproducible analysis'], examples: [], limitations: [] });
const requirements = normalizeSpecialistRequirements({ summary: 'Analyze sales', domain: 'data', taskType: 'data_analysis' });
let catalog: ReturnType<typeof initializeTestAgentCatalog>;
let conversationId: string;
const context: MatchingContext = { ownAgentId: 'personal-owner' };
beforeEach(() => {
  catalog = initializeTestAgentCatalog({ agents: [{ id: 'personal-owner' }, { id: 'coder' },
    { id: 'data-analyst', specialistProfile: profile }, { id: 'disabled', enabled: false }] });
  conversationId = createConversation({ agentId: 'personal-owner', customData: { personalAgent: true } }, '/tmp').key;
});
afterEach(() => { vi.restoreAllMocks(); closeXopcDatabase(); });

function taskInput(key: string) {
  return TaskCreateRequestSchema.parse({ idempotencyKey: key, title: 'Analyze sales',
    originConversationId: conversationId, delegateAgentId: 'data-analyst',
    contract: { ...defineTaskContract('Analyze sales'), acceptancePolicy: 'manual', outputDestinations: [] }, activation: { mode: 'start', executor: { kind: 'agent', agentId: 'data-analyst' } } });
}
const selection = () => ({ conversationId, requirements, context, source: 'snapshot' as const, reason: 'Matches data analysis and report delivery' });

describe('specialist matching', () => {
  it('round-trips an optional catalog profile without inheriting it into other Agents', () => {
    const stored = catalog.get('data-analyst')!;
    const entry = catalog.snapshot().agents.find(agent => agent.id === stored.id)!;
    expect(entry.specialistProfile).toEqual(profile);
    expect(resolveEffectiveAgentConfig({ agent: entry, defaults: catalog.getSettings().defaults }).config.specialistProfile).toEqual(profile);
    expect(catalog.get('coder')?.specialistProfile).toBeUndefined();
    expect(() => z.toJSONSchema(SpecialistProfileSchema)).not.toThrow();
  });

  it('orders by declared task fit while keeping legacy and blocked candidates explicit', () => {
    const result = matchSpecialists(requirements, context);
    expect(result.candidates[0]?.id).toBe('data-analyst');
    expect(result.candidates.find(agent => agent.id === 'coder')?.profileSource).toBe('legacy');
    expect(result.candidates.find(agent => agent.id === 'disabled')?.eligibility).toBe('blocked');
    expect(result.candidates.some(agent => agent.id.startsWith('personal-'))).toBe(false);
    expect(result.candidates[0]?.checks.find(check => check.condition === 'model')?.state).toBe('configured');
  });

  it('never substitutes a user-selected unavailable Agent', () => {
    const result = matchSpecialists({ ...requirements, requestedAgentId: 'disabled' }, context);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ id: 'disabled', eligibility: 'blocked' });
    expect(assessSpecialist('coder', { ...requirements, requestedAgentId: 'data-analyst' }, context).eligibility).toBe('blocked');
  });

  it('distinguishes configured tools, verified registrations, and unavailable Skills', () => {
    const input = { ...requirements, requiredTools: ['exec_command'] };
    expect(assessSpecialist('data-analyst', input, context).eligibility).toBe('needs_verification');
    expect(assessSpecialist('data-analyst', input, { ...context,
      getAgentToolAvailability: (_id, tool) => ({ condition: `tool:${tool}`, state: 'verified', reasonCode: 'registered' }) }).eligibility).toBe('eligible');
    expect(assessSpecialist('data-analyst', { ...requirements, requiredSkills: ['missing'] }, context).eligibility).toBe('needs_verification');
    expect(assessSpecialist('data-analyst', { ...requirements, requiredSkills: ['missing'] }, { ...context,
      getAgentSkillAvailability: () => ({ skills: [] }) }).eligibility).toBe('blocked');
  });

  it('keeps failed availability probes unverified and avoids probing disabled Agents', () => {
    const probe = vi.fn(() => { throw new Error('runtime unavailable'); });
    const result = matchSpecialists({ ...requirements, requiredTools: ['exec_command'] }, { ...context, getAgentToolAvailability: probe });
    expect(result.candidates.find(agent => agent.id === 'data-analyst')?.eligibility).toBe('needs_verification');
    expect(result.candidates.find(agent => agent.id === 'disabled')?.eligibility).toBe('blocked');
    expect(probe.mock.calls.every((args: unknown[]) => args[0] !== 'disabled')).toBe(true);
  });

  it('preserves pagination and rejects a cursor after catalog changes', () => {
    const first = matchSpecialists(requirements, context, { limit: 1 });
    const second = matchSpecialists(requirements, context, { limit: 1, cursor: first.nextCursor });
    expect(second.candidates[0]?.id).not.toBe(first.candidates[0]?.id);
    catalog.update('coder', catalog.get('coder')!.revision, { id: 'coder', profile: { name: 'Updated' } });
    expect(() => matchSpecialists(requirements, context, { cursor: first.nextCursor })).toThrow('changed');
  });

  it('covers twelve representative task briefs with explicit acceptable candidates', () => {
    const specialists = [
      ['eval-coder', 'software', ['bug_fix', 'code_review', 'implementation']],
      ['eval-writer', 'writing', ['writing', 'editing']],
      ['eval-researcher', 'research', ['research', 'news_research']],
      ['eval-data', 'data', ['data_analysis', 'data_cleaning']],
      ['eval-creative', 'design', ['image_generation']],
      ['eval-automation', 'operations', ['automation']],
    ] as const;
    for (const [id, domain, taskTypes] of specialists) catalog.create({ id,
      specialistProfile: { ...profile, domains: [domain], taskTypes: [...taskTypes] } }, { ready: true });
    const cases = [
      ['Fix payment bug', 'software', 'bug_fix', 'eval-coder'],
      ['Review security change', 'software', 'code_review', 'eval-coder'],
      ['Implement API handler', 'software', 'implementation', 'eval-coder'],
      ['Draft product announcement', 'writing', 'writing', 'eval-writer'],
      ['Edit supplied report', 'writing', 'editing', 'eval-writer'],
      ['Compare primary sources', 'research', 'research', 'eval-researcher'],
      ['Check current news with dated sources', 'research', 'news_research', 'eval-researcher'],
      ['Analyze sales CSV', 'data', 'data_analysis', 'eval-data'],
      ['Clean duplicated spreadsheet rows', 'data', 'data_cleaning', 'eval-data'],
      ['Generate campaign image', 'design', 'image_generation', 'eval-creative'],
      ['Schedule recurring report', 'operations', 'automation', 'eval-automation'],
      ['Investigate connected inbox', 'research', 'research', 'eval-researcher'],
    ];
    for (const [summary, domain, taskType, expected] of cases) {
      const result = matchSpecialists({ ...requirements, summary: summary!, domain, taskType }, context);
      const acceptable = taskType === 'data_analysis' ? [expected, 'data-analyst'] : [expected];
      expect(acceptable, summary).toContain(result.candidates[0]?.id);
    }
  });

  it('normalizes repeated requirements without inventing fuzzy equivalences', () => {
    expect(normalizeSpecialistRequirements({ summary: 'Analyze', requiredSkills: ['Research', ' research '] }).requiredSkills).toEqual(['research']);
    expect(assessSpecialist('data-analyst', { ...requirements, taskType: 'custom_analysis' }, context).missing).toContain('taskType:custom_analysis');
  });
});

describe('selection persistence', () => {
  it('atomically links Task and run, and replays committed choices after the Agent becomes unavailable', () => {
    const result = createSelectedTask(taskInput('once'), { kind: 'system' }, selection());
    expect(result.ok).toBe(true);
    const records = new AgentSelectionRepository().list(conversationId);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ taskId: result.model?.task.id, status: 'task_linked', selectedAgentId: 'data-analyst' });
    expect(records[0]?.taskRunId).toBeTruthy();
    catalog.update('data-analyst', catalog.get('data-analyst')!.revision, { id: 'data-analyst', enabled: false });
    expect(createSelectedTask(taskInput('once'), { kind: 'system' }, selection()).model?.task.id).toBe(result.model?.task.id);
    expect(new TaskRepository().list()).toHaveLength(1);
    expect(new AgentSelectionRepository().list(conversationId)[0]?.assessment.specialistProfile).toEqual(profile);
  });

  it('rejects key reuse with changed intent and cross-conversation reads', () => {
    createSelectedTask(taskInput('once'), { kind: 'system' }, selection());
    expect(() => createSelectedTask({ ...taskInput('once'), title: 'Different' }, { kind: 'system' }, selection())).toThrow('different input');
    const other = createConversation({ agentId: 'personal-owner' }, '/tmp').key;
    expect(new AgentSelectionRepository().list(other)).toEqual([]);
  });

  it('rolls back both selection and Task when domain creation throws', () => {
    const original = TaskApplicationService.prototype.create;
    vi.spyOn(TaskApplicationService.prototype, 'create').mockImplementation(function (this: TaskApplicationService, ...args) {
      original.apply(this, args);
      throw new Error('simulated storage failure');
    });
    expect(() => createSelectedTask(taskInput('rollback'), { kind: 'system' }, selection())).toThrow('storage failure');
    expect(new TaskRepository().list()).toEqual([]);
    expect(new AgentSelectionRepository().list(conversationId)).toEqual([]);
  });

  it('links a durable Task even when starting is blocked', () => {
    const input = taskInput('blocked');
    input.contract.approvalRequired = ['external_write'];
    const result = createSelectedTask(input, { kind: 'system' }, selection());
    expect(result.ok).toBe(false);
    expect(new AgentSelectionRepository().list(conversationId)[0]).toMatchObject({ taskId: result.model?.task.id, status: 'start_blocked' });
  });

  it('retains historical evidence when an Agent is removed and cleans up with its conversation', () => {
    createSelectedTask(taskInput('history'), { kind: 'system' }, selection());
    catalog.delete('data-analyst');
    expect(new AgentSelectionRepository().list(conversationId)[0]?.assessment.specialistProfile).toEqual(profile);
    deleteSessionRecord(conversationId);
    expect(getSqliteDatabase().prepare('SELECT count(*) AS count FROM agent_selection_records').get()).toEqual({ count: 0 });
  });
});

