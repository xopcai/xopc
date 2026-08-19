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
import { analyzeWorkContext } from '../analyzer.js';
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
});
