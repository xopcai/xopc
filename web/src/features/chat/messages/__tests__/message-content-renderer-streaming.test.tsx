// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChunkedContent } from '@/features/chat/messages/message-content-renderer';
import { AssistantStepsBlock } from '@/features/chat/messages/assistant-steps-block';
import type { AssistantTurnWorkLogPresentation } from '@/features/chat/messages/assistant-turn-view-model';
import type { MessageContent } from '@/features/chat/messages/messages.types';
import { useDevViewStore } from '@/stores/dev-view-store';
import { messages } from '@/i18n/messages';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';
import { ExtensionProvider } from '@/features/extensions/extension-provider';

const emptyLabels = {
  input: '',
  output: '',
  noOutput: '',
};

const stepLabels = {
  thoughts: '',
  thoughtsStreaming: '',
  workLogTitle: 'Work log',
  workLogRunning: 'Working',
  workLogComplete: 'Worked for',
  workLogPartial: 'Partially completed in',
  workLogFailed: 'Failed after',
  searchedWeb: '',
  searchedMemory: '',
  searchedCode: '',
  searched: '',
  readFile: 'Read file',
  stepDetails: '',
  runCommand: 'Run command',
  listDirectory: '',
  writeFile: '',
  editFile: '',
  openUrl: '',
  fetchUrl: '',
  unknownTool: '',
  rawThinking: '',
  toolError: '',
  toolActivity: messages('en').chat.toolActivity,
  memoryActivity: {
    running: '', found_one: '', found_other: '', empty: '', failed: '', purpose: '', why: '', explanation: '', manage: '', privacy: '',
  },
};

const clusterLabels = {
  ing: new Proxy({}, { get: (_target, key) => String(key) }) as never,
};

const cardLabels = new Proxy({}, {
  get: (_target, key) => key === 'exitCodeNonZero' ? 'Exit {{code}}' : String(key),
}) as never;

describe('streaming assistant Markdown rendering', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useWorkspacePreviewStore.getState().setPath(null);
    useDevViewStore.setState({ showRawToolData: false });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useWorkspacePreviewStore.getState().setPath(null);
    useDevViewStore.setState({ showRawToolData: false });
    vi.useRealTimers();
  });

  function render(
    content: MessageContent[],
    streaming: boolean,
    progressiveRender = false,
    workLog?: AssistantTurnWorkLogPresentation,
    workspaceConversationId?: string,
  ) {
    act(() => {
      root.render(
        <MemoryRouter>
          <ExtensionProvider>
            {workLog ? (
              <AssistantStepsBlock
                workLog={workLog}
                toolLabels={emptyLabels}
                stepLabels={stepLabels}
                clusterLabels={clusterLabels}
                cardLabels={cardLabels}
                conversationId="side-chat-id"
                workflowOptions={{ labels: {} as never }}
              />
            ) : null}
            <ChunkedContent
              content={content}
              isUser={false}
              isAssistantMessageStreaming={streaming}
              imagePreviewLabel=""
              onImagePreview={undefined}
              conversationId="side-chat-id"
              workspaceConversationId={workspaceConversationId}
              progressiveRender={progressiveRender}
            />
          </ExtensionProvider>
        </MemoryRouter>,
      );
    });
  }

  it('hides ordinary compact activity after completion and never offers a drawer', () => {
    const tool = { type: 'tool_use', id: 'r', name: 'read_file', status: 'done', input: { path: 'secret.txt' } } as const;
    const workLog = { items: [tool], active: true, status: 'running', expandedByDefault: false, compact: true } as const;
    render([], true, false, { ...workLog, items: [tool] });
    expect(container.textContent).toContain('mixed');
    expect(container.textContent).not.toContain('secret.txt');
    expect(container.querySelector('button[aria-expanded]')).toBeNull();
    render([], false, false, { ...workLog, items: [tool], active: false, status: 'completed' });
    expect(container.textContent).toBe('');
  });

  it('hides thinking rows normally and exposes them only in debug details', () => {
    const workLog: AssistantTurnWorkLogPresentation = {
      items: [{ type: 'thinking', text: 'Private reasoning', streaming: true }],
      active: true, status: 'running', expandedByDefault: true, compact: false,
    };
    render([], true, false, workLog);
    expect(container.textContent).not.toContain('Private reasoning');
    expect(container.querySelector('button[aria-expanded]')).toBeNull();
    act(() => useDevViewStore.setState({ showRawToolData: true }));
    expect(container.querySelector('details')?.textContent).toContain('Private reasoning');
  });

  it.each([false, true])('respects explicit expansion on completion: %s', (manual) => {
    const workLog: AssistantTurnWorkLogPresentation = {
      items: [{ type: 'tool_use', id: 'r', name: 'read_file', status: 'running' }],
      active: true, status: 'running', expandedByDefault: true, compact: false,
    };
    render([], true, false, workLog);
    expect(container.querySelector('button[aria-expanded="true"]')).not.toBeNull();
    if (manual) {
      act(() => container.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click());
      act(() => container.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click());
    }
    render([], false, false, { ...workLog, active: false, status: 'completed', expandedByDefault: false });
    expect(container.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe(String(manual));
  });

  it.each(['off', 'on', 'stream'] as const)('keeps browser approvals visible in %s mode', (mode) => {
    const tool = {
      type: 'tool_use', id: 'approval', name: 'browser_use', status: 'done',
      details: { kind: 'browser_approval_required', error: { approval: {
        id: 'approval-1', risk: 'external_effect', summary: 'Confirm publishing the article', expiresAt: '2099-01-01T00:00:00Z',
      } } },
    } as const;
    render([], false, false, {
      items: [tool], active: false, status: 'completed', expandedByDefault: false, compact: mode === 'off',
    });
    expect(container.textContent).toContain('Confirm publishing the article');
    expect(container.querySelector('.assistant-steps-scroll')).toBeNull();
  });

  it('keeps errors visible in compact mode without a success title', () => {
    render([], false, false, {
      items: [{ type: 'tool_use', id: 'r', name: 'read_file', status: 'error', result: 'Permission denied' }],
      active: false, status: 'failed', expandedByDefault: false, compact: true,
    });
    expect(container.textContent).toContain('Permission denied');
    expect(container.textContent).not.toContain('Read file');
    expect(container.querySelector('button[aria-expanded]')).toBeNull();
  });

  it('keeps file delivery cards visible when normal activity is hidden', () => {
    render([], false, false, {
      items: [{ type: 'tool_use', id: 'w', name: 'write_file', status: 'done', input: { path: 'proposal.md', content: 'Proposal' } }],
      active: false, status: 'completed', expandedByDefault: false, compact: true,
    });
    expect(container.textContent).toContain('proposal.md');
    expect(container.querySelector('button[aria-expanded]')).toBeNull();
  });

  it('opens Sidechat workspace links against the parent conversation', () => {
    render(
      [{ type: 'text', text: '[Open page](checklist.html)' }],
      false,
      false,
      undefined,
      'parent-conversation-id',
    );

    act(() => container.querySelector<HTMLAnchorElement>('a')?.click());

    expect(useWorkspacePreviewStore.getState()).toMatchObject({
      path: 'checklist.html',
      conversationId: 'parent-conversation-id',
    });
  });

  it('preserves the tail DOM node when it becomes a completed block', () => {
    vi.useFakeTimers();
    render([{ type: 'text', text: 'Intro.\n\nStill streaming' }], true);
    act(() => vi.advanceTimersByTime(48));
    act(() => vi.advanceTimersByTime(32));
    act(() => vi.advanceTimersByTime(32));
    act(() => vi.advanceTimersByTime(32));
    const previousTail = container.querySelector('.markdown-stream-tail');
    expect(previousTail).not.toBeNull();

    render(
      [{ type: 'text', text: 'Intro.\n\nStill streaming\n\nNext block' }],
      true,
    );
    act(() => vi.advanceTimersByTime(32));
    const completedBlock = Array.from(
      container.querySelectorAll('.markdown-stream-block'),
    ).find((element) => element.textContent?.includes('Still streaming'));

    expect(completedBlock).toBe(previousTail);
  });

  it('keeps the streaming block tree mounted when the response completes', () => {
    vi.useFakeTimers();
    const content: MessageContent[] = [
      { type: 'text', text: 'Intro.\n\nFinal answer' },
    ];
    render(content, true);
    act(() => vi.advanceTimersByTime(48));
    act(() => vi.advanceTimersByTime(32));
    act(() => vi.advanceTimersByTime(32));
    act(() => vi.advanceTimersByTime(32));
    const blockTree = container.querySelector('.markdown-stream-blocks');
    const firstBlock = container.querySelector('.markdown-stream-block');
    expect(blockTree).not.toBeNull();
    expect(firstBlock).not.toBeNull();

    render(content, false);

    expect(container.querySelector('.markdown-stream-blocks')).toBe(blockTree);
    expect(container.querySelector('.markdown-stream-block')).toBe(firstBlock);
  });

  it('renders completed Mermaid blocks while the response continues streaming', async () => {
    render([{
      type: 'text',
      text: '```mermaid\ngraph TD\nA --> B\n```\n\nStill streaming',
    }], true);

    await vi.waitFor(() => {
      expect(container.querySelector('[data-mermaid-diagram] svg')).not.toBeNull();
    });
    expect(container.textContent).toContain('Still streaming');
  });

  it.each([
    {
      name: 'ER diagram',
      source: [
        'erDiagram',
        '    MESSAGE ||--o{ CARD : references',
        '    MESSAGE {',
        '        string id',
        '        json metadata',
        '    }',
        '    CARD {',
        '        string id',
        '        string message_id',
        '    }',
      ],
    },
    {
      name: 'flowchart',
      source: [
        'flowchart TD',
        '    QA[QA Card]',
        '    QA --> Interaction[Interaction Card<br/>与 Agent 执行绑定]',
        '    QA --> Product[Product Card<br/>由业务系统投递]',
        '    Interaction --> Single[qa_single_select]',
        '    Product --> Auth[qa_connector_auth]',
      ],
    },
  ])('renders a completed $name in an earlier text segment while a later segment streams', async ({ source }) => {
    render([
      {
        type: 'text',
        text: [
          '```mermaid',
          ...source,
          '```',
        ].join('\n'),
        segmentId: 'diagram',
        presentation: 'answer',
      },
      {
        type: 'text',
        text: 'Message details are still streaming',
        segmentId: 'details',
        presentation: 'pending',
      },
    ], true);

    await vi.waitFor(() => {
      expect(container.querySelector('[data-mermaid-diagram] svg')).not.toBeNull();
    });
    expect(container.querySelector('pre code.language-mermaid')).toBeNull();
    expect(container.textContent).toContain('Message details');
  });

  it('renders a tail Mermaid block as soon as streaming completes', async () => {
    const content: MessageContent[] = [{
      type: 'text',
      text: '```mermaid\ngraph TD\nA --> B\n```',
    }];
    render(content, true);

    expect(container.querySelector('[data-mermaid-diagram]')).toBeNull();
    expect(container.querySelector('pre code.language-mermaid')).not.toBeNull();

    render(content, false);

    await vi.waitFor(() => {
      expect(container.querySelector('[data-mermaid-diagram] svg')).not.toBeNull();
    });
    expect(container.querySelector('pre code.language-mermaid')).toBeNull();
  });

  it('coalesces plain-text deltas on the adaptive schedule', () => {
    vi.useFakeTimers();
    render([{ type: 'text', text: 'First' }], true);

    expect(container.textContent?.trim()).toBe('First');

    render([{ type: 'text', text: 'First update' }], true);

    expect(container.textContent?.trim()).toBe('First');
    act(() => vi.advanceTimersByTime(48));
    expect(container.textContent?.trim()).toBe('First updat');
    act(() => vi.advanceTimersByTime(32));
    expect(container.textContent?.trim()).toBe('First update');
  });

  it('renders a completed response immediately when the session view mounts', () => {
    vi.useFakeTimers();
    render([{ type: 'text', text: 'abcdefghijkl' }], false, true);

    expect(container.textContent?.trim()).toBe('abcdefghijkl');
  });

  it('renders punctuation-bound strong text through the assistant message pipeline', () => {
    const text = [
      '所以问题的根源，可能不是"怎么放下她"，而是**"你现在的孤独感，有没有别的地方可以安放？"**',
      '',
      '我先问你一个具体的、不复杂的问题，你如实说就好：',
    ].join('\n');

    render([{ type: 'text', text }], false);

    const strong = container.querySelector('.markdown-body strong');
    expect(strong, container.innerHTML).not.toBeNull();
    expect(strong?.textContent).toBe('"你现在的孤独感，有没有别的地方可以安放？"');
    expect(container.textContent).not.toContain('**');
  });

  it('renders tool groups at their original positions between narration updates', () => {
    const firstTool = { type: 'tool_use', id: 'read-1', name: 'read_file', status: 'done' } as const;
    const secondTool = { type: 'tool_use', id: 'command-1', name: 'run_command', status: 'done' } as const;
    const content: MessageContent[] = [
      { type: 'text', text: '开始检查。', presentation: 'narration' },
      firstTool,
      { type: 'text', text: '已经找到组件。', presentation: 'narration' },
      secondTool,
      { type: 'text', text: '修改完成。', presentation: 'answer' },
    ];

    render(content.filter((block) => block.type === 'text' && block.presentation === 'answer'), false, false, {
      items: content.filter((block): block is Extract<MessageContent, { type: 'text' | 'tool_use' }> => (
        block.type === 'tool_use' || (block.type === 'text' && block.presentation === 'narration')
      )),
      active: false,
      status: 'completed',
      expandedByDefault: false,
      compact: false,
    });

    const disclosureButtons = container.querySelectorAll('button[aria-expanded]');
    expect(disclosureButtons).toHaveLength(1);
    act(() => (disclosureButtons[0] as HTMLButtonElement | undefined)?.click());
    const text = container.textContent ?? '';
    expect(text.indexOf('开始检查。')).toBeLessThan(text.indexOf('Read file'));
    expect(text.indexOf('Read file')).toBeLessThan(text.indexOf('已经找到组件。'));
    expect(text.indexOf('已经找到组件。')).toBeLessThan(text.indexOf('Run command'));
    expect(text.indexOf('Run command')).toBeLessThan(text.indexOf('修改完成。'));
  });

  it('keeps the latest completed tool segment active while the run is still streaming', () => {
    vi.useFakeTimers();
    vi.setSystemTime(31_000);
    const completedTool = {
      type: 'tool_use', id: 'read-1', name: 'read_file', status: 'done',
      startedAt: 1_000, completedAt: 2_000,
    } as const;

    render([completedTool], true, false, {
      items: [completedTool],
      active: true,
      status: 'running',
      expandedByDefault: false,
      compact: false,
      startedAt: 1_000,
      durationMs: 1_000,
    });

    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(container.textContent).toContain('30');
  });

  it('keeps a failed tool reason visible outside the collapsed trace', () => {
    const failedTool = {
      type: 'tool_use',
      id: 'command-1',
      name: 'run_command',
      status: 'error',
      result: JSON.stringify({ details: { exitCode: 1 }, content: [] }),
    } as const;

    render([failedTool], false, false, {
      items: [failedTool],
      active: false,
      status: 'failed',
      expandedByDefault: false,
      compact: false,
    });

    expect(container.textContent).toContain('Failed after');
    expect(container.textContent).toContain('Exit 1');
    const disclosure = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    act(() => disclosure?.click());

    const trace = container.querySelector('.assistant-steps-scroll');
    expect(trace?.textContent).toContain('Exit 1');
    expect(trace?.querySelector('svg')).toBeNull();
    expect(trace?.querySelector('[class*="text-red"]')).toBeNull();
  });

  it('uses input-aware wording for xopc_use inside the expanded work log', () => {
    const xopcTool = {
      type: 'tool_use',
      id: 'xopc-1',
      name: 'xopc_use',
      status: 'done',
      input: { mode: 'note', command: 'update' },
    } as const;

    render([xopcTool], false, false, {
      items: [xopcTool],
      active: false,
      status: 'completed',
      expandedByDefault: false,
      compact: false,
    });

    const disclosure = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    act(() => disclosure?.click());
    expect(container.textContent).toContain('Updated note');
  });

  it('keeps expanded assistant activity in a bounded scroll region', () => {
    useDevViewStore.setState({ showRawToolData: true });
    const thinking = { type: 'thinking', text: 'Long reasoning', streaming: false } as const;

    render([thinking], false, false, {
      items: [thinking],
      active: false,
      status: 'completed',
      expandedByDefault: false,
      compact: false,
    });

    const disclosure = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    expect(disclosure).not.toBeNull();
    act(() => disclosure?.click());

    const activityScroll = container.querySelector<HTMLElement>('.assistant-steps-scroll');
    expect(activityScroll).not.toBeNull();
    expect(activityScroll?.classList.contains('overflow-y-auto')).toBe(true);
    expect(activityScroll?.classList.contains('overscroll-y-contain')).toBe(false);
    expect(activityScroll?.className).toContain('max-h-[min(60vh,28rem)]');

    container.classList.add('chat-messages');
    Object.defineProperties(activityScroll, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
    });
    Object.defineProperties(container, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_000 },
    });
    const nestedOutput = document.createElement('pre');
    nestedOutput.style.overflowY = 'auto';
    Object.defineProperties(nestedOutput, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 130 },
    });
    activityScroll?.append(nestedOutput);
    nestedOutput.scrollTop = 20;
    activityScroll!.scrollTop = 175;
    container.scrollTop = 80;

    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40 });
    act(() => nestedOutput.dispatchEvent(wheel));

    expect(nestedOutput.scrollTop).toBe(30);
    expect(activityScroll?.scrollTop).toBe(200);
    expect(container.scrollTop).toBe(85);
    expect(wheel.defaultPrevented).toBe(true);

    nestedOutput.scrollTop = 5;
    activityScroll!.scrollTop = 10;
    container.scrollTop = 100;

    const reverseWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -30 });
    act(() => nestedOutput.dispatchEvent(reverseWheel));

    expect(nestedOutput.scrollTop).toBe(0);
    expect(activityScroll?.scrollTop).toBe(0);
    expect(container.scrollTop).toBe(85);
    expect(reverseWheel.defaultPrevented).toBe(true);
  });

  it('renders punctuation-bound strong text after progressive streaming completes', () => {
    vi.useFakeTimers();
    const text = '前文有"普通引号"，而是**"流式完成后也必须加粗。"**';

    render([{ type: 'text', text }], true);
    for (let step = 0; step < 30; step += 1) {
      act(() => vi.advanceTimersByTime(48));
    }
    render([{ type: 'text', text }], false);

    const strong = container.querySelector('.markdown-body strong');
    expect(strong?.textContent).toBe('"流式完成后也必须加粗。"');
    expect(container.textContent).not.toContain('**');
  });
});
