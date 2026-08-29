import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/schema.js', () => ({
  getAgentDefaultModelRef: vi.fn(() => 'test/model'),
}));

vi.mock('../../providers/index.js', () => ({
  resolveModel: vi.fn(() => ({ provider: 'test', id: 'model' })),
}));

vi.mock('../../providers/model-call.js', () => ({
  completeWithResolvedCredentials: vi.fn(),
}));

import { completeWithResolvedCredentials } from '../../providers/model-call.js';
import { analyzeUnderstandingSources, analyzeWorkContext } from '../analyzer.js';
import type { UnderstandingSourceItem } from '../../user-context/sources/types.js';
import type { WorkContextSnapshot } from '../types.js';

const snapshot: WorkContextSnapshot = {
  root: { displayName: 'demo', projectKind: 'coding', markerReasons: ['package.json'] },
  structure: { sampledPaths: ['README.md'], metadataOnlyFiles: [], omittedPathCount: 0 },
  git: { branch: 'main', changedPaths: ['README.md'], recentCommits: [] },
  documents: [{
    relativePath: 'README.md',
    excerpt: 'Current project notes',
    truncated: false,
    selectionReason: 'recently changed',
  }],
  limits: { policyVersion: 1, fileCount: 1, contentBytes: 21, truncated: false },
};

function validAnalysisJson(): string {
  const suggestion = (index: number) => ({
    actionType: index === 1 ? 'summarize_recent_work' : index === 2 ? 'inspect_related_tests' : 'plan_next_step',
    title: `Suggestion ${index}`,
    rationale: `Reason ${index}`,
    evidence: [{ path: 'README.md', observation: 'Contains current project notes.' }],
    actionPrompt: `Investigate step ${index}.`,
    confidence: 'medium',
    expectedTask: `Task ${index}`,
    estimatedMinutes: 5,
    risk: 'analysis',
    verification: ['Review the result.'],
  });
  return JSON.stringify({
    projectSummary: 'A demo software project.',
    currentState: 'The README contains current notes.',
    uncertainties: [],
    suggestions: [suggestion(1), suggestion(2), suggestion(3)],
    profileCandidates: [],
    workThreads: [],
    conversationStarter: 'Explain the current README changes and suggest the best next step.',
    lowConfidence: false,
    contextQuestion: '',
  });
}

describe('work discovery analyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses a sufficient output budget and finds JSON after an unrelated fenced block', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue({
      content: [{ type: 'text', text: `\`\`\`text\nnot json\n\`\`\`\n\`\`\`json\n${validAnalysisJson()}\n\`\`\`` }],
      stopReason: 'stop',
    } as never);

    const analysis = await analyzeWorkContext({ config: {} as never, snapshot });

    expect(analysis.result.suggestions).toHaveLength(3);
    expect(completeWithResolvedCredentials).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ maxTokens: 6_000 }),
    );
  });

  it('reports output truncation instead of a generic JSON failure', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue({
      content: [{ type: 'text', text: '{"projectSummary":"unfinished"' }],
      stopReason: 'length',
    } as never);

    await expect(analyzeWorkContext({ config: {} as never, snapshot }))
      .rejects.toThrow('Analysis response was truncated before completing valid JSON (outputChars=30)');
  });

  it('keeps a project-aware conversation starter when confidence is low', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        lowConfidence: true,
        suggestions: [],
        contextQuestion: 'Which README goal matters most?',
        conversationStarter: 'Explain the current README changes and what I should clarify first.',
      }) }],
      stopReason: 'stop',
    } as never);

    const analysis = await analyzeWorkContext({ config: {} as never, snapshot });

    expect(analysis.result).toMatchObject({
      lowConfidence: true,
      contextQuestion: 'Which README goal matters most?',
      conversationStarter: 'Explain the current README changes and what I should clarify first.',
    });
  });

  it('validates understanding profile candidates against initialized evidence refs', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        profileCandidates: [{
          category: 'workflow',
          statement: 'Reviews recent project notes regularly.',
          confidence: 'high',
          evidence: ['A recent project note was found.'],
          evidenceRefs: ['local-recent-files://item-1'],
        }],
        workThreads: [],
      }) }],
      stopReason: 'stop',
    } as never);
    const item: UnderstandingSourceItem = {
      id: 'item-1',
      sourceId: 'local-recent-files',
      type: 'document',
      title: 'Project notes',
      ownerAttribution: 'user',
      sensitivity: 'personal',
      evidenceRef: 'local-recent-files://item-1',
    };

    const analysis = await analyzeUnderstandingSources({ config: {} as never, items: [item] });

    expect(analysis.profileCandidates).toHaveLength(1);
    expect(analysis.profileCandidates[0]?.evidenceRefs).toEqual(['local-recent-files://item-1']);
  });

  it('keeps every valid understanding and work stream instead of applying fixed item caps', async () => {
    const evidenceRef = 'local-recent-files://item-1';
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        profileCandidates: Array.from({ length: 7 }, (_, index) => ({
          category: 'focus',
          statement: `Supported user focus ${index + 1}`,
          confidence: 'high',
          evidence: [`Evidence ${index + 1}`],
          evidenceRefs: [evidenceRef],
        })),
        workThreads: Array.from({ length: 4 }, (_, index) => ({
          topicKey: `stream-${index + 1}`,
          title: `Work stream ${index + 1}`,
          summary: `Evidence-backed work stream ${index + 1}`,
          horizon: 'ongoing',
          status: 'active',
          confidence: 'high',
          evidenceRefs: [evidenceRef],
        })),
      }) }],
      stopReason: 'stop',
    } as never);
    const sourceItem: UnderstandingSourceItem = {
      id: 'item-1',
      sourceId: 'local-recent-files',
      type: 'document',
      title: 'Project notes',
      ownerAttribution: 'user',
      sensitivity: 'personal',
      evidenceRef,
    };

    const analysis = await analyzeUnderstandingSources({ config: {} as never, items: [sourceItem] });

    expect(analysis.profileCandidates).toHaveLength(7);
    expect(analysis.workThreadCandidates).toHaveLength(4);
  });
});
