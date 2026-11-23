// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  prefetch: vi.fn(),
  recordPriority: vi.fn(),
  importTools: vi.fn(),
  fetchOnboarding: vi.fn(),
  dismissOnboarding: vi.fn(),
  grantFolder: vi.fn(),
  startRun: vi.fn(),
  fetchRun: vi.fn(),
  importSources: vi.fn(),
  selectSuggestion: vi.fn(),
  submitFeedback: vi.fn(),
  setAssertionStatus: vi.fn(),
  addCollaborationPreference: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mocks.navigate };
});
vi.mock('@/components/brand/loopi', () => ({ Loopi: () => null }));
vi.mock('@/lib/electron-window-chrome', () => ({ isElectronDarwin: () => false }));
vi.mock('@/features/onboarding/desktop-onboarding-bootstrap', () => ({
  prefetchDesktopOnboardingContext: mocks.prefetch,
  recordCurrentFocusPriority: mocks.recordPriority,
  importSafeAiToolConfigs: mocks.importTools,
}));
vi.mock('@/features/user-model/user-model-api', () => ({
  setAssertionStatus: mocks.setAssertionStatus,
  addCollaborationPreference: mocks.addCollaborationPreference,
}));
vi.mock('@/features/work-discovery/api', () => ({
  fetchWorkDiscoveryOnboarding: mocks.fetchOnboarding,
  dismissWorkDiscoveryOnboarding: mocks.dismissOnboarding,
  grantUnderstandingWorkFolder: mocks.grantFolder,
  startWorkDiscoveryRun: mocks.startRun,
  fetchWorkDiscoveryRun: mocks.fetchRun,
  importUnderstandingSources: mocks.importSources,
  cancelWorkDiscoveryRun: vi.fn().mockResolvedValue({}),
  retryWorkDiscoveryRun: vi.fn(),
  selectWorkDiscoverySuggestion: mocks.selectSuggestion,
  submitWorkDiscoveryRecognitionFeedback: mocks.submitFeedback,
}));

import { useLocaleStore } from '@/stores/locale-store';
import { useUnderstandingActivityStore } from '@/features/work-discovery/understanding-activity-store';
import { DesktopFocusOnboarding } from '../desktop-focus-onboarding';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.clearAllMocks();
  useLocaleStore.setState({ language: 'zh' });
  useUnderstandingActivityStore.setState({ directoryRun: null });
  mocks.fetchOnboarding.mockResolvedValue({ enabled: true, state: { status: 'not_started' } });
  mocks.dismissOnboarding.mockResolvedValue(undefined);
  mocks.recordPriority.mockResolvedValue(undefined);
  mocks.importTools.mockResolvedValue({ importedCount: 4, skills: 3, context: 1, projects: 0 });
  mocks.grantFolder.mockResolvedValue({});
  mocks.selectSuggestion.mockResolvedValue(undefined);
  mocks.submitFeedback.mockResolvedValue({});
  mocks.setAssertionStatus.mockResolvedValue({});
  mocks.addCollaborationPreference.mockResolvedValue({});
  mocks.prefetch.mockResolvedValue({
    candidates: [
      {
        id: 'path:/repo/xopc',
        rootPath: '/repo/xopc',
        displayName: 'xopc',
        source: 'ai_tool_project',
        projectKind: 'coding',
        projectKindConfidence: 0.95,
        score: 92,
        branch: 'feat/onboarding',
        changedFileCount: 5,
        evidence: ['recent AI tool project'],
      },
    ],
    recentFiles: [
      {
        id: 'aaaaaaaaaaaaaaaa',
        name: 'Q4报价对比.xlsx',
        directory: '/Users/demo/Desktop',
        rootLabel: 'Desktop',
        extension: '.xlsx',
        modifiedAt: Date.now(),
      },
      {
        id: 'bbbbbbbbbbbbbbbb',
        name: '产品路线图.md',
        directory: '/Users/demo/Documents',
        rootLabel: 'Documents',
        extension: '.md',
        modifiedAt: Date.now() - 3_600_000,
      },
    ],
    processingTarget: { provider: 'xopc-cloud', remoteModel: true },
    importSources: [{ id: 'claude-code', name: 'Claude Code', detected: true }],
  });

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  delete (window as { electronAPI?: unknown }).electronAPI;
  await act(async () => root.unmount());
  container.remove();
});

const renderFocus = async (onRequestClose = vi.fn(), onNavigateAway = vi.fn()) => {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <DesktopFocusOnboarding onRequestClose={onRequestClose} onNavigateAway={onNavigateAway} />
      </MemoryRouter>,
    );
  });
  return { onRequestClose, onNavigateAway };
};

describe('DesktopFocusOnboarding', () => {
  it('renders zero-prompt local signal chips, read-only badge, fast-understand CTA, and compact Claude Code import', async () => {
    await renderFocus();

    expect(container.textContent).toContain('先认识你的工作，或直接说一件事');
    expect(container.textContent).toContain('发现 3 处本机线索');
    expect(container.textContent).toContain('只读');
    expect(container.textContent).toContain('快速认识我');
    expect(container.textContent).toContain('xopc');
    expect(container.textContent).toContain('Q4报价对比.xlsx');
    expect(container.textContent).toContain('产品路线图.md');
    expect(container.textContent).toContain('Claude Code');
  });

  it('runs fast local-file understanding with excluded chips, allows removing/adding traits, and launches a thread', async () => {
    const collect = vi.fn().mockResolvedValue([
      {
        sourceId: 'local-recent-files',
        status: 'completed',
        items: [
          {
            id: 'bbbbbbbbbbbbbbbb12345678',
            sourceId: 'local-recent-files',
            type: 'document',
            title: '产品路线图.md',
            group: 'Documents',
            text: '# Q4 Roadmap',
            ownerAttribution: 'user',
            sensitivity: 'personal',
            evidenceRef: 'local-recent-files://bbbbbbbbbbbbbbbb12345678',
          },
        ],
      },
    ]);
    window.electronAPI = {
      understandingSources: {
        catalog: vi.fn().mockResolvedValue([]),
        collect,
      },
    } as never;

    mocks.importSources.mockResolvedValue({
      profileCandidates: [
        {
          id: 'cand-1',
          assertionId: 'assert-1',
          category: 'role',
          factKey: 'role:product-lead',
          statement: '负责产品与研发推进',
          confidence: 'high',
          evidence: ['产品路线图.md'],
          status: 'pending',
        },
      ],
      workThreads: [
        {
          id: 'thread-1',
          canonicalKey: 'source-thread:q4-roadmap',
          title: '推进 Q4 产品路线图',
          summary: '正在梳理 Q4 发布里程碑',
          status: 'active',
          horizon: 'current',
          focusScore: 0.9,
          confidence: 0.9,
          userStatus: 'unreviewed',
          projectIds: [],
          evidenceIds: ['local-recent-files://bbbbbbbbbbbbbbbb12345678'],
        },
      ],
      knowledgeCandidates: [],
      sourceStatuses: [{ sourceId: 'local-recent-files', status: 'completed' }],
    });

    await renderFocus();

    // Exclude one local file chip before scanning
    const excludeBtn = container.querySelector('button[aria-label="排除 Q4报价对比.xlsx"]') as HTMLButtonElement;
    await act(async () => excludeBtn.click());
    expect(container.textContent).not.toContain('Q4报价对比.xlsx');

    // Click "快速认识我"
    const understandBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('快速认识我'))!;
    await act(async () => understandBtn.click());

    expect(collect).toHaveBeenCalledExactlyOnceWith(['local-recent-files'], {
      mode: 'fast',
      excludeIds: ['aaaaaaaaaaaaaaaa'],
    });
    expect(mocks.importSources).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ title: '产品路线图.md' })]),
      undefined,
      'remote_allowed',
      undefined,
      'zh-CN',
    );

    // Reveal shows interactive trait chip and thread card
    expect(container.textContent).toContain('我大致了解你最近的重心了');
    expect(container.textContent).toContain('负责产品与研发推进');
    expect(container.textContent).toContain('推进 Q4 产品路线图');

    // Remove trait chip directly
    const removeTraitBtn = container.querySelector('button[aria-label="移除标签 负责产品与研发推进"]') as HTMLButtonElement;
    await act(async () => removeTraitBtn.click());
    expect(mocks.setAssertionStatus).toHaveBeenCalledWith('assert-1', 'rejected');
    expect(container.textContent).not.toContain('负责产品与研发推进');

    // Add a custom trait chip inline
    const addBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('补充'))!;
    await act(async () => addBtn.click());
    const traitInput = container.querySelector('input[placeholder="补充一句偏好或角色…"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(traitInput, '偏好简洁直接的结论');
      traitInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const saveTraitBtn = container.querySelector('button[aria-label="保存补充"]') as HTMLButtonElement;
    await act(async () => saveTraitBtn.click());
    expect(mocks.addCollaborationPreference).toHaveBeenCalledWith('偏好简洁直接的结论');
    expect(container.textContent).toContain('偏好简洁直接的结论');

    // Click primary thread card to jump straight into chat
    const startThreadBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('推进 Q4 产品路线图'))!;
    await act(async () => startThreadBtn.click());
    expect(mocks.recordPriority).toHaveBeenCalledWith('推进 Q4 产品路线图');
    expect(mocks.dismissOnboarding).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith(expect.stringContaining('/chat/new?'));
    expect(mocks.navigate).toHaveBeenCalledWith(expect.stringContaining('autoSend=1'));
  });

  it('launches immediately into autoSend chat and records top priority when user submits a goal', async () => {
    const { onNavigateAway } = await renderFocus();

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '准备明天下午的产品评审');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const startBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('立刻开始'))!;
    await act(async () => startBtn.click());

    expect(mocks.recordPriority).toHaveBeenCalledWith('准备明天下午的产品评审');
    expect(mocks.dismissOnboarding).toHaveBeenCalledOnce();
    expect(onNavigateAway).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith(expect.stringContaining('/chat/new?'));
    expect(mocks.navigate).toHaveBeenCalledWith(expect.stringContaining('autoSend=1'));
  });

  it('imports safe Claude Code skills and rules inline with one click', async () => {
    await renderFocus();

    const importBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('一键带入'))!;
    await act(async () => importBtn.click());

    expect(mocks.importTools).toHaveBeenCalledExactlyOnceWith(['claude-code']);
    expect(container.textContent).toContain('已带入 4 项 Claude Code 配置');
  });

  it('analyzes a clicked project chip and launches its primary recommendation into autoSend chat', async () => {
    const completedRun = {
      id: 'run-1',
      status: 'completed' as const,
      rootPath: '/repo/xopc',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      result: {
        projectSummary: 'xopc 正在优化桌面端 onboarding 流程。',
        currentState: '有 5 个未提交文件改动。',
        uncertainties: [],
        primarySuggestionId: 'sug-1',
        suggestions: [
          {
            id: 'sug-1',
            actionType: 'plan_next_step' as const,
            title: '补齐新流程的端到端测试',
            rationale: '核心组件已就绪，需要验证边界恢复逻辑。',
            evidence: [{ path: 'web/src/features/onboarding/onboarding-card.tsx', observation: '最近修改' }],
            actionPrompt: '帮我为新 onboarding 流程补齐测试',
            confidence: 'high' as const,
            expectedTask: '新增单元测试并跑通',
            estimatedMinutes: 3,
            risk: 'analysis' as const,
            verification: [],
          },
        ],
      },
    };
    mocks.startRun.mockResolvedValue(completedRun);

    await renderFocus();
    const projectBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('xopc'))!;
    await act(async () => projectBtn.click());

    expect(mocks.grantFolder).toHaveBeenCalledWith('/repo/xopc', 'remote_allowed');
    expect(mocks.startRun).toHaveBeenCalledWith('/repo/xopc');
    expect(container.textContent).toContain('补齐新流程的端到端测试');

    const goBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === '开始')!;
    await act(async () => goBtn.click());

    expect(mocks.selectSuggestion).toHaveBeenCalledWith('run-1', 'sug-1');
    expect(mocks.navigate).toHaveBeenCalledWith(expect.stringContaining('/chat/conv-1?'));
    expect(mocks.navigate).toHaveBeenCalledWith(expect.stringContaining('autoSend=1'));
  });

  it('offers just-in-time Apple Calendar context when typing a meeting goal and attaches collected events', async () => {
    const collect = vi.fn().mockResolvedValue([
      {
        sourceId: 'apple-calendar',
        status: 'completed',
        items: [
          {
            id: 'evt-1',
            sourceId: 'apple-calendar',
            type: 'calendar_event',
            title: '产品评审会',
            startsAt: Date.now(),
            ownerAttribution: 'unknown',
            sensitivity: 'personal',
            evidenceRef: 'apple-calendar://evt-1',
          },
        ],
      },
    ]);
    window.electronAPI = {
      understandingSources: {
        catalog: vi.fn().mockResolvedValue([
          {
            id: 'apple-calendar',
            category: 'calendar',
            platform: 'darwin',
            displayName: 'Apple Calendar',
            description: '',
            availability: 'available',
            permission: 'not_requested',
            defaultAccessMode: 'once',
            supportedAccessModes: ['once'],
            recommended: false,
            sensitive: true,
          },
        ]),
        collect,
      },
    } as never;

    await renderFocus();
    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '准备明天下午的产品评审会议');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(container.textContent).toContain('Apple 日历');
    const includeBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('读取近期日程'))!;
    await act(async () => includeBtn.click());

    expect(collect).toHaveBeenCalledExactlyOnceWith(['apple-calendar']);
    expect(container.textContent).toContain('已附带 Apple 日历（1 条）');

    const startBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('立刻开始'))!;
    await act(async () => startBtn.click());

    expect(mocks.navigate).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('产品评审会')));
  });

  it('gracefully hides local signal strip and renders clean starter pills on an empty device', async () => {
    mocks.prefetch.mockResolvedValue({
      candidates: [],
      recentFiles: [],
      processingTarget: { provider: 'xopc-cloud', remoteModel: true },
      importSources: [],
    });

    await renderFocus();

    expect(container.textContent).toContain('现在最想先推进什么？');
    expect(container.textContent).not.toContain('快速认识我');
    expect(container.textContent).toContain('理清今天最重要的 3 件事');
    expect(container.textContent).toContain('准备下一场重要会议');
  });
});
