import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import { buildActiveProjectContextForPrompt } from '../../agent/context/project-context.js';
import { ProjectService } from '../../projects/project-service.js';
import type { SessionIndex } from '../../session/manager.js';
import { closeXopcDatabase, ensureSessionRecord, getSessionMetadata, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { listUserAssertions } from '../../user-model/index.js';
import { analyzeWorkContext } from '../analyzer.js';
import { getProjectUnderstandingOverview, saveProjectUnderstandingOverview } from '../project-understanding.js';
import { WorkDiscoveryService } from '../service.js';

vi.mock('../analyzer.js', () => ({ analyzeWorkContext: vi.fn(), analyzeUnderstandingSources: vi.fn(), workDiscoveryResultMarkdown: vi.fn() }));
vi.mock('../investigator.js', () => ({ investigateWorkContext: vi.fn(async ({ snapshot }) => ({
  documents: snapshot.documents, evidence: [], degraded: false,
  investigation: { id: 'investigation', plan: { hypotheses: [], questions: [] }, toolCallCount: 0, contentCharsRead: 0 },
})) }));

describe('background project understanding', () => {
  let root: string;
  let projects: ProjectService;
  let service: WorkDiscoveryService;
  const emit = vi.fn();
  const sessions = { appendTranscriptCustomMessageEntry: vi.fn(), updateSessionMetadata: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), 'xopc-project-understanding-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(root, 'xopc.db') });
    writeFileSync(join(root, 'README.md'), '# Example\nRun pnpm test.');
    projects = new ProjectService();
    service = new WorkDiscoveryService({ projects, sessions: sessions as unknown as SessionIndex,
      getConfig: () => ({ agents: { list: [], defaults: { models: { chat: { primary: 'openai/gpt-4o' } } } } }) as unknown as Config, emit });
    vi.spyOn(service, 'getModelProcessingTarget').mockReturnValue({ provider: 'local', remoteModel: false });
    vi.mocked(analyzeWorkContext).mockResolvedValue({ modelRef: 'test', result: {
      projectSummary: 'Example project. See README.md.', currentState: 'Tests run with pnpm test.',
      uncertainties: ['The current user objective is unknown.'], suggestions: [], profileCandidates: [],
    } });
  });

  afterEach(async () => {
    await service.stop();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns immediately, deduplicates, and stores reusable understanding without visible chat or personal assertions', async () => {
    const project = projects.create({ name: 'Example', workspaceRoot: root });
    const run = service.startProjectUnderstanding(project.id);
    expect(run.status).toBe('queued');
    expect(service.startProjectUnderstanding(project.id).id).toBe(run.id);
    expect(analyzeWorkContext).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(service.getRun(run.id)?.status).toBe('completed'));
    expect(getSessionMetadata(run.conversationId)?.hiddenFromSessionList).toBe(true);
    expect(projects.listWithSidebarSessions({ status: 'active', updatedAfter: Date.now() - 60_000 }).items.map((item) => item.id)).toContain(project.id);
    expect(sessions.appendTranscriptCustomMessageEntry).not.toHaveBeenCalled();
    expect(sessions.updateSessionMetadata).not.toHaveBeenCalled();
    expect(emit.mock.calls.every(([name]) => name === 'project.updated')).toBe(true);
    expect(listUserAssertions()).toEqual([]);
    expect(getProjectUnderstandingOverview(project.id)?.content).toContain('pnpm test');
    expect(getProjectUnderstandingOverview(project.id)?.content).toContain('unknown');
    expect(service.getRun(run.id)?.attempts).toBe(1);
    const chat = "b9d376ef-df81-41d6-8000-0ce9282047ae";
    ensureSessionRecord(chat, root, { agentId: "main", projectId: project.id });
    expect(buildActiveProjectContextForPrompt(chat)).toContain('pnpm test');
    expect(buildActiveProjectContextForPrompt(chat)).toContain('provisional');
    expect(buildActiveProjectContextForPrompt(chat, { includeKnowledge: false })).not.toContain('pnpm test');
  });

  it('retries once and leaves a persistent failure state', async () => {
    vi.mocked(analyzeWorkContext).mockRejectedValue(new Error('Model temporarily unavailable'));
    const project = projects.create({ name: 'Example', workspaceRoot: root });
    const run = service.startProjectUnderstanding(project.id);
    await vi.waitFor(() => expect(service.getRun(run.id)?.attempts).toBe(2));
    await vi.waitFor(() => expect(service.getRun(run.id)?.status).toBe('failed'));
    expect(analyzeWorkContext).toHaveBeenCalledTimes(2);
  });

  it('does not publish knowledge after the project is canceled and deleted during analysis', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const result = await vi.mocked(analyzeWorkContext)({} as never);
    vi.mocked(analyzeWorkContext).mockImplementation(async () => { await barrier; return result; });
    const project = projects.create({ name: 'Example', workspaceRoot: root });
    const run = service.startProjectUnderstanding(project.id);
    await vi.waitFor(() => expect(service.getRun(run.id)?.status).toBe('analyzing'));
    service.cancelRun(run.id);
    projects.delete(project.id);
    release();
    await service.stop();
    expect(getProjectUnderstandingOverview(project.id)).toBeUndefined();
  });

  it('preserves user corrections on refresh and isolates project knowledge', () => {
    saveProjectUnderstandingOverview({ projectId: 'one', content: 'User corrected overview', correctedByUser: true });
    saveProjectUnderstandingOverview({ projectId: 'one', content: 'Generated replacement' });
    saveProjectUnderstandingOverview({ projectId: 'two', content: 'Another project' });
    expect(getProjectUnderstandingOverview('one')?.content).toBe('User corrected overview');
    expect(getProjectUnderstandingOverview('two')?.content).toBe('Another project');
  });

  it('resumes interrupted background work without adding a new run', async () => {
    const result = await vi.mocked(analyzeWorkContext)({} as never);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(analyzeWorkContext).mockImplementationOnce(async () => { await barrier; return result; });
    const project = projects.create({ name: 'Example', workspaceRoot: root });
    const run = service.startProjectUnderstanding(project.id);
    await vi.waitFor(() => expect(service.getRun(run.id)?.status).toBe('analyzing'));
    const stopping = service.stop();
    release();
    await stopping;
    expect(service.getRun(run.id)?.status).toBe('queued');
    expect(getProjectUnderstandingOverview(project.id)).toBeUndefined();
    service.resumeProjectUnderstanding();
    await vi.waitFor(() => expect(service.getRun(run.id)?.status).toBe('completed'));
    expect(service.getRun(run.id)?.attempts).toBe(2);
  });
});
