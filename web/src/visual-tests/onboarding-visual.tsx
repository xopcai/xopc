import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { DesktopFocusOnboarding } from '@/features/onboarding/desktop-focus-onboarding';
import { OnboardingCard } from '@/features/onboarding/onboarding-card';
import { SidebarFooter } from '@/components/shell/sidebar-footer';
import { UserModelPage } from '@/features/user-model/user-model-page';
import { WorkDiscoveryPage } from '@/features/work-discovery/work-discovery-page';
import { useLocaleStore } from '@/stores/locale-store';
import type { ColorScheme } from '@/stores/theme-store';

import '@fontsource-variable/figtree';
import '@/styles/globals.css';

type VisualStage = 'setup' | 'work' | 'profile' | 'desktop-focus';
type VisualMode = 'light' | 'dark';

const params = new URLSearchParams(window.location.search);
const requestedStage = params.get('stage');
const stage: VisualStage = requestedStage === 'profile'
  ? 'profile'
  : requestedStage === 'work'
    ? 'work'
    : requestedStage === 'desktop-focus'
      ? 'desktop-focus'
      : 'setup';
const mode: VisualMode = params.get('mode') === 'dark' ? 'dark' : 'light';
const requestedTheme = params.get('theme');
const theme: ColorScheme = requestedTheme === 'emerald' || requestedTheme === 'clay' || requestedTheme === 'porcelain'
  ? requestedTheme
  : 'default';

document.documentElement.classList.toggle('dark', mode === 'dark');
document.documentElement.dataset.theme = mode;
document.documentElement.dataset.colorScheme = theme;
document.documentElement.style.colorScheme = mode;
useLocaleStore.setState({ language: params.get('lang') === 'zh' ? 'zh' : 'en' });

const json = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

window.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/api/user-model')) {
    return json({
      profile: { callName: 'Alex', role: '', pronouns: '', timezone: '', locale: 'en-US' },
      assertions: [],
      goals: [],
      priorities: [],
      rules: [],
      knowledge: [],
      settings: { memoryEnabled: true, showMemoryReferences: true, sensitiveWritePolicy: 'confirm' },
      maintenance: { lastRun: null },
      counts: {
        activeAssertions: 0,
        reviewAssertions: 0,
        activeGoals: 0,
        activePriorities: 0,
        activeKnowledge: 0,
      },
    });
  }
  if (url.includes('/api/onboarding/work-discovery')) {
    return json({ enabled: true, state: { status: 'not_started' } });
  }
  if (url.includes('/api/work-discovery/candidates')) {
    return json({
      ok: true,
      candidates: [
        {
          id: 'path:/Users/alex/develop/xopc',
          rootPath: '/Users/alex/develop/xopc',
          displayName: 'xopc',
          source: 'ai_tool_project',
          projectKind: 'coding',
          projectKindConfidence: 0.95,
          score: 94,
          branch: 'feat/onboarding',
          changedFileCount: 5,
          evidence: ['recent AI tool project'],
        },
      ],
      recentFiles: [
        {
          id: 'rf-1',
          name: 'Q4-Vendor-Quotes.xlsx',
          directory: '/Users/alex/Desktop',
          rootLabel: 'Desktop',
          extension: '.xlsx',
          modifiedAt: Date.now(),
        },
        {
          id: 'rf-2',
          name: 'Review-Notes.md',
          directory: '/Users/alex/Documents',
          rootLabel: 'Documents',
          extension: '.md',
          modifiedAt: Date.now() - 3_600_000,
        },
      ],
      processingTarget: { provider: 'xopc-cloud', remoteModel: true },
    });
  }
  if (url.includes('/api/imports/sources')) {
    return json({ ok: true, data: { sources: [{ id: 'claude-code', name: 'Claude Code', detected: true }] } });
  }
  if (url.includes('/api/context-sources/bootstrap')) {
    return json({
      profileCandidates: [
        {
          id: 'cand-1',
          assertionId: 'assert-1',
          category: 'role',
          factKey: 'role:product-eng',
          statement: params.get('lang') === 'zh' ? '产品与工程负责人' : 'Product & engineering lead',
          confidence: 'high',
          evidence: ['Review-Notes.md'],
          status: 'pending',
        },
        {
          id: 'cand-2',
          assertionId: 'assert-2',
          category: 'preference',
          factKey: 'pref:concise',
          statement: params.get('lang') === 'zh' ? '偏好先给结论再展开' : 'Prefers crisp takeaways first',
          confidence: 'medium',
          evidence: ['Q4-Vendor-Quotes.xlsx'],
          status: 'pending',
        },
      ],
      workThreads: [
        {
          id: 'thread-1',
          canonicalKey: 'source-thread:q4-quotes',
          title: params.get('lang') === 'zh' ? '对比 Q4 供应商报价' : 'Compare Q4 vendor quotes',
          summary: 'Reviewing Q4 pricing tables and delivery terms',
          status: 'active',
          horizon: 'current',
          focusScore: 0.92,
          confidence: 0.9,
          userStatus: 'unreviewed',
          projectIds: [],
          evidenceIds: ['local-recent-files://rf-1'],
        },
        {
          id: 'thread-2',
          canonicalKey: 'source-thread:product-review',
          title: params.get('lang') === 'zh' ? '整理产品评审议程' : 'Prep product review agenda',
          summary: 'Drafting review milestones and open questions',
          status: 'active',
          horizon: 'ongoing',
          focusScore: 0.8,
          confidence: 0.85,
          userStatus: 'unreviewed',
          projectIds: [],
          evidenceIds: ['local-recent-files://rf-2'],
        },
      ],
      knowledgeCandidates: [],
      sourceStatuses: [{ sourceId: 'local-recent-files', status: 'completed' }],
    });
  }
  if (url.includes('/api/user-model/assertions') || url.includes('/api/user-model/priorities')) {
    return json({ ok: true });
  }
  throw new Error(`Unexpected visual fixture request: ${url}`);
};

if (stage === 'desktop-focus' && !window.electronAPI) {
  window.electronAPI = {
    understandingSources: {
      catalog: async () => [],
      collect: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        return [
          {
            sourceId: 'local-recent-files',
            status: 'completed',
            items: [
              {
                id: 'rf-1',
                sourceId: 'local-recent-files',
                type: 'document',
                title: 'Q4-Vendor-Quotes.xlsx',
                group: 'Desktop',
                text: 'Q4 vendor quote comparison',
                ownerAttribution: 'user',
                sensitivity: 'personal',
                evidenceRef: 'local-recent-files://rf-1',
              },
              {
                id: 'rf-2',
                sourceId: 'local-recent-files',
                type: 'document',
                title: 'Review-Notes.md',
                group: 'Documents',
                text: 'Product review notes',
                ownerAttribution: 'user',
                sensitivity: 'personal',
                evidenceRef: 'local-recent-files://rf-2',
              },
            ],
          },
        ];
      },
    },
  } as never;
}

export function VisualFixture() {
  if (stage === 'profile') return <div className="flex h-dvh bg-surface-base text-fg">
    <aside className="flex w-60 shrink-0 flex-col justify-end border-r border-edge max-sm:w-14"><SidebarFooter collapsed={window.innerWidth < 640} /></aside>
    <main className="min-w-0 flex-1 overflow-auto"><UserModelPage /></main>
  </div>;
  return (
    <div className="h-dvh w-dvw overflow-hidden" data-visual-stage={stage}>
      {stage === 'setup' ? (
        <OnboardingCard onComplete={() => {}} onDismiss={() => {}} />
      ) : stage === 'desktop-focus' ? (
        <DesktopFocusOnboarding onRequestClose={() => {}} onNavigateAway={() => {}} />
      ) : (
        <WorkDiscoveryPage embedded onRequestClose={() => {}} onNavigateAway={() => {}} />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/onboarding/workspace?new=1']}>
    <VisualFixture />
  </MemoryRouter>,
);
