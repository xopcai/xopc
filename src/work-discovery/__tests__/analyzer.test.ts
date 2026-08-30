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
    const request = vi.mocked(completeWithResolvedCredentials).mock.calls[0]?.[1] as {
      messages?: Array<{ content?: string }>;
    };
    expect(request.messages?.[0]?.content).toContain('can be shown directly to the person described');
    expect(request.messages?.[0]?.content).toContain('not “用户倾向于使用 pnpm”');
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

  it('keeps evidence-backed understanding when next-step confidence is low', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        projectSummary: 'A TypeScript product repository.',
        currentState: 'The exact next objective is unclear.',
        uncertainties: ['The next milestone is not explicit.'],
        lowConfidence: true,
        suggestions: [],
        contextQuestion: 'Which milestone matters now?',
        profileCandidates: [{
          category: 'technology',
          statement: 'Works on a TypeScript product.',
          confidence: 'high',
          evidence: ['README.md describes the TypeScript product.'],
        }],
        workThreads: [{
          topicKey: 'typescript-product',
          title: 'TypeScript product',
          summary: 'The repository contains active TypeScript product work.',
          horizon: 'ongoing',
          status: 'active',
          confidence: 'high',
          evidenceRefs: ['README.md'],
        }],
      }) }],
      stopReason: 'stop',
    } as never);

    const analysis = await analyzeWorkContext({ config: {} as never, snapshot });

    expect(analysis.result).toMatchObject({
      lowConfidence: true,
      projectSummary: 'A TypeScript product repository.',
      profileCandidates: [expect.objectContaining({ statement: 'Works on a TypeScript product.' })],
      workThreadCandidates: [expect.objectContaining({ topicKey: 'typescript-product' })],
    });
  });

  it('keeps profile candidates for a normal manual scan without candidate context', async () => {
    const parsed = JSON.parse(validAnalysisJson()) as Record<string, unknown>;
    parsed.profileCandidates = [{
      category: 'workflow',
      statement: 'Maintains current project notes in the repository.',
      confidence: 'medium',
      evidence: ['README.md contains current project notes.'],
    }];
    vi.mocked(completeWithResolvedCredentials).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(parsed) }],
      stopReason: 'stop',
    } as never);

    const analysis = await analyzeWorkContext({ config: {} as never, snapshot });

    expect(analysis.result.profileCandidates).toEqual([
      expect.objectContaining({ statement: 'Maintains current project notes in the repository.' }),
    ]);
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
    const request = vi.mocked(completeWithResolvedCredentials).mock.calls[0]?.[1] as {
      messages?: Array<{ content?: string }>;
    };
    expect(request.messages?.[0]?.content).toContain('can be shown directly to the person described');
    expect(request.messages?.[0]?.content).toContain('not “The user prefers pnpm”');
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

  it('keeps successful sources when another source fails', async () => {
    vi.mocked(completeWithResolvedCredentials)
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({
          profileCandidates: [{
            category: 'focus',
            statement: 'Plans work from calendar commitments.',
            confidence: 'medium',
            evidence: ['A current calendar commitment was found.'],
            evidenceRefs: ['apple-calendar://calendar-1'],
          }],
          workThreads: [],
        }) }],
        stopReason: 'stop',
      } as never);
    const items: UnderstandingSourceItem[] = [
      {
        id: 'note-1', sourceId: 'apple-notes', type: 'note', title: 'Project note',
        ownerAttribution: 'user', sensitivity: 'personal', evidenceRef: 'apple-notes://note-1',
      },
      {
        id: 'calendar-1', sourceId: 'apple-calendar', type: 'calendar_event', title: 'Project review',
        ownerAttribution: 'user', sensitivity: 'personal', evidenceRef: 'apple-calendar://calendar-1',
      },
    ];

    const analysis = await analyzeUnderstandingSources({ config: {} as never, items });

    expect(analysis.profileCandidates).toHaveLength(1);
    expect(analysis.sourceStatuses).toEqual([
      expect.objectContaining({ sourceId: 'apple-notes', status: 'failed' }),
      { sourceId: 'apple-calendar', status: 'completed' },
    ]);
  });

  it('splits and recovers a batch when model output is truncated', async () => {
    const resultFor = (ref: string, statement: string) => ({
      content: [{ type: 'text', text: JSON.stringify({
        profileCandidates: [{
          category: 'focus', statement, confidence: 'medium', evidence: ['Supported item.'], evidenceRefs: [ref],
        }],
        workThreads: [],
      }) }],
      stopReason: 'stop',
    });
    vi.mocked(completeWithResolvedCredentials)
      .mockResolvedValueOnce({ content: [{ type: 'text', text: '{"profileCandidates":[' }], stopReason: 'length' } as never)
      .mockResolvedValueOnce(resultFor('apple-notes://note-1', 'Advances the first project.') as never)
      .mockResolvedValueOnce(resultFor('apple-notes://note-2', 'Advances the second project.') as never);
    const items: UnderstandingSourceItem[] = [1, 2].map((index) => ({
      id: `note-${index}`,
      sourceId: 'apple-notes',
      type: 'note',
      title: `Project note ${index}`,
      ownerAttribution: 'user',
      sensitivity: 'personal',
      evidenceRef: `apple-notes://note-${index}`,
    }));

    const analysis = await analyzeUnderstandingSources({ config: {} as never, items });

    expect(completeWithResolvedCredentials).toHaveBeenCalledTimes(3);
    expect(analysis.profileCandidates).toHaveLength(2);
    expect(analysis.sourceStatuses).toEqual([{ sourceId: 'apple-notes', status: 'completed' }]);
  });
});
