import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { buildExecutionContext } from '../../agent/context/execution-context.js';
import { ConfigSchema } from '../../config/schema.js';
import { listKnowledgeItems } from '../../knowledge-memory/index.js';
import { ProjectService } from '../../projects/project-service.js';
import { listCollaborationRules } from '../../storage/sqlite/collaboration-rule-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { listUnderstandingSourceGrants, revokeUnderstandingSourceGrant } from '../../user-context/sources/repository.js';
import type { UnderstandingSourceItem } from '../../user-context/sources/types.js';
import { getUserAssertion } from '../../user-model/index.js';
import { analyzeUnderstandingSources } from '../analyzer.js';
import { WorkDiscoveryService } from '../service.js';

vi.mock('../analyzer.js', () => ({
  analyzeWorkContext: vi.fn(),
  analyzeUnderstandingSources: vi.fn(),
  workDiscoveryResultMarkdown: vi.fn(),
}));

describe('Deep-Understanding Onboarding pipeline (Phase 0-2)', () => {
  let service: WorkDiscoveryService;
  const emit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
    seedTestAgentCatalog();
    service = new WorkDiscoveryService({
      projects: new ProjectService(),
      sessions: {} as never,
      getConfig: () => ConfigSchema.parse({}),
      emit,
    });
    vi.spyOn(service, 'getModelProcessingTarget').mockReturnValue({ provider: 'openai', remoteModel: true });
  });

  afterEach(async () => {
    await service.stop();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  it('persists cross-source domains, accurate independentSourceCount, work_thread memory, and deduplicates promoted writing rules', async () => {
    vi.mocked(analyzeUnderstandingSources).mockResolvedValue({
      modelRef: 'openai/gpt-5',
      profileCandidates: [
        {
          id: 'p1',
          category: 'role',
          domain: 'identity',
          factKey: 'role:ai-systems-builder',
          statement: 'Builds local-first desktop AI products and full-stack TypeScript systems.',
          confidence: 'high',
          evidence: ['Obsidian architecture notes and AI instructions align.'],
          evidenceRefs: ['local-obsidian://n1', 'local-ai-instructions://r1'],
          sourceIds: ['local-obsidian', 'local-ai-instructions'],
          independentSourceCount: 2,
          status: 'pending',
        },
      ],
      writingPreferences: [
        {
          id: 'w1',
          dimension: 'structure',
          factKey: 'writing:structure',
          statement: 'Lead with conclusions, followed by structured bullet points or tables.',
          confidence: 'high',
          evidence: ['Consistent pattern across Obsidian notes and CLAUDE.md.'],
          evidenceRefs: ['local-obsidian://n1'],
          sourceIds: ['local-obsidian'],
          status: 'pending',
        },
      ],
      workThreadCandidates: [
        {
          topicKey: 'desktop-onboarding-v2',
          title: 'Deep-understanding desktop onboarding',
          summary: 'Unify local sources and cross-source synthesis for first-run setup.',
          status: 'active',
          horizon: 'current',
          confidence: 'high',
          evidenceRefs: ['local-obsidian://n1', 'local-ai-instructions://r1'],
          sourceIds: ['local-obsidian', 'local-ai-instructions'],
          recommendedFirstStep: 'Finalize Stage B schema and run unit tests.',
        },
      ],
      calibrationQuestions: [
        {
          id: 'q1',
          question: 'Should weekly focus prioritize desktop UX or gateway plugins?',
          options: ['Desktop UX', 'Gateway plugins'],
        },
      ],
      sourceStatuses: [
        { sourceId: 'local-obsidian', status: 'completed' },
        { sourceId: 'local-ai-instructions', status: 'completed' },
      ],
    });

    const precollectedItems: UnderstandingSourceItem[] = [
      {
        id: 'n1',
        sourceId: 'local-obsidian',
        type: 'note',
        title: 'Onboarding Architecture',
        text: 'Design a clean multi-source understanding flow without legacy branches.',
        ownerAttribution: 'user',
        sensitivity: 'personal',
        evidenceRef: 'local-obsidian://n1',
      },
      {
        id: 'r1',
        sourceId: 'local-ai-instructions',
        type: 'note',
        title: 'Claude: CLAUDE.md',
        text: 'Lead with conclusions, followed by structured bullet points or tables.',
        ownerAttribution: 'user',
        sensitivity: 'normal',
        evidenceRef: 'local-ai-instructions://r1',
      },
    ];

    const started = service.startDeepUnderstandingRun({
      precollectedItems,
      processingPolicy: 'remote_allowed',
      locale: 'en-US',
    });
    expect(started.status).toBe('running');

    // Wait for async run completion.
    for (let i = 0; i < 40; i++) {
      const current = service.getDeepUnderstandingRun(started.id);
      if (current && current.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }

    const finished = service.getDeepUnderstandingRun(started.id)!;
    expect(finished.status).toBe('completed');
    expect(finished.result?.aboutYou).toHaveLength(1);
    expect(finished.result?.writingPreferences).toHaveLength(1);
    expect(finished.result?.workThreads).toHaveLength(1);
    expect(finished.result?.calibrationQuestions).toHaveLength(1);

    // Verify independentSourceCount === 2 (exact, no orphan onboarding evidence).
    const aboutAssertionId = finished.result!.aboutYou[0]!.assertionId!;
    const aboutAssertion = getUserAssertion(aboutAssertionId)!;
    expect(aboutAssertion.domain).toBe('identity');
    expect(aboutAssertion.independentSourceCount).toBe(2);

    // Verify work thread persisted in knowledge_memory with kind='work_thread'.
    const threadsInDb = listKnowledgeItems({ recordClass: 'memory', limit: 20 });
    expect(threadsInDb.some((item) => item.kind === 'work_thread' && item.content.includes('Deep-understanding desktop onboarding'))).toBe(true);

    // Confirm Reveal selections: promote aboutYou + writingPreference to active collaboration_rule.
    const writingPref = finished.result!.writingPreferences[0]!;
    const confirmation = service.confirmDeepUnderstandingRun(started.id, {
      aboutYou: [{ id: 'p1', assertionId: aboutAssertionId, decision: 'accepted' }],
      writingPreferences: [{
        id: 'w1',
        assertionId: writingPref.assertionId,
        dimension: 'structure',
        decision: 'accepted',
        statement: writingPref.statement,
        sourceIds: writingPref.sourceIds,
      }],
      customWritingRules: ['Avoid excessive emojis in responses.'],
      markOnboardingCompleted: true,
    });
    expect(confirmation.createdRuleIds).toHaveLength(2);
    expect(getUserAssertion(aboutAssertionId)?.authority).toBe('user_explicit');

    // Confirming twice is idempotent and does not duplicate collaboration rules.
    const repeatConfirm = service.confirmDeepUnderstandingRun(started.id, {
      aboutYou: [{ id: 'p1', assertionId: aboutAssertionId, decision: 'accepted' }],
      writingPreferences: [{
        id: 'w1',
        assertionId: writingPref.assertionId,
        dimension: 'structure',
        decision: 'accepted',
        statement: writingPref.statement,
        sourceIds: writingPref.sourceIds,
      }],
      customWritingRules: ['Avoid excessive emojis in responses.'],
      markOnboardingCompleted: true,
    });
    expect(repeatConfirm.createdRuleIds).toHaveLength(0);

    // Verify execution-context deduplicates the writing assertion promoted to collaboration_rules!
    const ctx = buildExecutionContext({
      agentId: 'main',
      conversationId: 'conv-1',
      query: 'Help me write a design summary',
    });
    expect(ctx.rules.some((rule) => rule.statement.includes('Lead with conclusions'))).toBe(true);
    expect(ctx.assertions.some((entry) => entry.assertion.id === writingPref.assertionId)).toBe(false);
    expect(ctx.assertions.some((entry) => entry.assertion.id === aboutAssertionId)).toBe(true);

    // Verify local source grant revocation cascades to derived non-edited collaboration_rule!
    const obsidianGrant = listUnderstandingSourceGrants().find((grant) => grant.adapterId === 'local-obsidian')!;
    expect(obsidianGrant.config.sourceInstanceId).toBe('local:local-obsidian');
    revokeUnderstandingSourceGrant(obsidianGrant.id);

    const rulesAfterRevoke = listCollaborationRules();
    const derivedRule = rulesAfterRevoke.find((rule) => rule.statement.includes('Lead with conclusions'));
    const customRule = rulesAfterRevoke.find((rule) => rule.statement.includes('Avoid excessive emojis'));
    expect(derivedRule?.status).toBe('disabled');
    expect(customRule?.status).toBe('active');
    // aboutAssertion still has 1 independent source left (local-ai-instructions) and stays active because user_explicit.
    expect(getUserAssertion(aboutAssertionId)?.independentSourceCount).toBe(1);
    expect(getUserAssertion(aboutAssertionId)?.status).toBe('active');
  });
});
