import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { closeXopcDatabase } from '../../../storage/sqlite/index.js';
import { createPersonalTaskTool, type PersonalTaskToolDeps } from '../personal-task-tool.js';

const { execute } = vi.hoisted(() => ({ execute: vi.fn(async () => ({ content: [{ type: 'text', text: 'Task created' }], details: {} })) }));
vi.mock('../xopc-use-tool.js', () => ({ createXopcUseTool: () => ({ execute }) }));
vi.mock('../../../personal-agent/repository.js', () => ({ isPersonalConversation: () => true }));
vi.mock('../../../personal-agent/specialist-capabilities.js', () => ({
  getAvailablePersonalAgentTools: () => ['read_file', 'exec_command'],
  personalAgentModelAvailability: () => ({ available: true }),
}));

const deps = (availability?: PersonalTaskToolDeps['getAgentSkillAvailability']): PersonalTaskToolDeps => ({
  getCurrentConversationId: () => 'personal-conversation', getCurrentAgentId: () => 'personal-owner',
  getAgentSkillAvailability: availability,
});
const available = () => ({ skills: [{ name: 'research', availableForCurrentAgent: true }] });

describe('Personal task explicit Skills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeTestAgentCatalog({ agents: [{ id: 'researcher', enabled: true }, { id: 'disabled', enabled: false }] });
  });
  afterEach(() => closeXopcDatabase());

  it('discovers only specialists that can use all requested Skills', async () => {
    const lookup = vi.fn((id: string) => id === 'researcher' ? available() : { skills: [] });
    const result = await createPersonalTaskTool(deps(lookup)).execute('find', { command: 'agents', requiredSkills: ['Research'] });
    const agents = JSON.parse((result.content[0] as { text: string }).text);
    expect(agents).toEqual([expect.objectContaining({ id: 'researcher', verifiedSkills: ['research'] })]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('revalidates access and carries canonical Skills, full objective and source materials into the chosen worker brief', async () => {
    const tool = createPersonalTaskTool(deps(available));
    const objective = 'Compare the reports. ' + 'Keep every requested detail. '.repeat(10);
    await tool.execute('create', { command: 'create', agentId: 'researcher', requiredSkills: [' Research '],
      objective, description: 'Source: /workspace/reports/full.pdf', idempotencyKey: 'request-1' });
    expect(execute).toHaveBeenCalledWith('create', expect.objectContaining({ mode: 'task', command: 'create', args: expect.objectContaining({
      agentId: 'researcher', createMode: 'start', idempotencyKey: 'request-1',
      body: expect.stringContaining('## Required Skills\n\n- research'),
    }) }), undefined, undefined);
    const args = (execute.mock.calls[0] as unknown as [string, { args: { body: string } }])[1].args;
    expect(args.body).toContain(objective.trim());
    expect(args.body).toContain('/workspace/reports/full.pdf');
    expect(args.body).toContain('do not claim a Skill was used');
  });

  it.each(['agent-denied', 'requirements-unmet', 'tool-gated', 'disabled'])('rejects creation when Skill access changes: %s', async reason => {
    const lookup = vi.fn(available);
    const tool = createPersonalTaskTool(deps(lookup));
    await tool.execute('find', { command: 'agents', requiredSkills: ['research'] });
    lookup.mockReturnValue({ skills: [{ name: 'research', availableForCurrentAgent: false, unavailableReason: reason }] } as ReturnType<typeof available>);
    await expect(tool.execute('create', { command: 'create', agentId: 'researcher', objective: 'Compare', requiredSkills: ['research'] })).rejects.toThrow(reason);
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports unverifiable or missing Skills without creating a substitute task', async () => {
    await expect(createPersonalTaskTool(deps()).execute('find', { command: 'agents', requiredSkills: ['research'] })).rejects.toThrow('cannot be verified');
    await expect(createPersonalTaskTool(deps(() => ({ skills: [] }))).execute('create', { command: 'create', agentId: 'researcher', objective: 'Compare', requiredSkills: ['missing'] })).rejects.toThrow('not-installed');
    await expect(createPersonalTaskTool(deps(available)).execute('create', { command: 'create', agentId: 'disabled', objective: 'Compare' })).rejects.toThrow('unavailable');
    expect(execute).not.toHaveBeenCalled();
  });

  it('preserves ordinary delegation without requiring a Skill lookup', async () => {
    await createPersonalTaskTool(deps()).execute('create', { command: 'create', agentId: 'researcher', objective: 'Compare the reports' });
    expect(execute).toHaveBeenCalledOnce();
  });
});
