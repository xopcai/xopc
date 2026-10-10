// @vitest-environment jsdom

import type { ProductDeliveryEnvelope } from '@xopcai/gateway-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/tasks/home-api', () => ({
  fetchTask: vi.fn(async () => ({ task: {} })),
}));

import { AssistantResultTail } from '@/features/chat/messages/assistant-result-tail';
import type { AssistantTurnViewModel } from '@/features/chat/messages/assistant-turn-view-model';
import { productDeliveryReferences } from '@/features/chat/product-delivery/product-delivery-model';
import { useLocaleStore } from '@/stores/locale-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderDelivery(delivery: ProductDeliveryEnvelope, conversationId?: string) {
  const view: AssistantTurnViewModel = {
    answerContent: [],
    workLog: { items: [], active: false, status: 'completed', expandedByDefault: false, compact: false },
    answer: { started: true, showStreamingCursor: false },
    lifecycle: { state: 'completed' },
    outcome: undefined,
    deliveries: [{ key: 'delivery-1', delivery }],
    sources: [],
  };
  return <AssistantResultTail view={view} conversationId={conversationId} />;
}

describe('AssistantResultTail product deliveries', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  it('shows only the latest task when one turn created duplicate tasks with the same title', () => {
    const deliveries = [
      { key: 'first', delivery: { version: 2, operation: 'started', primary: {
        kind: 'task', id: 'old-task', title: 'Personal AI 最新产品方向调研', capabilities: ['open'],
      } } },
      { key: 'second', delivery: { version: 2, operation: 'started', primary: {
        kind: 'task', id: 'new-task', title: 'Personal AI 最新产品方向调研', capabilities: ['open'],
      } } },
    ] satisfies AssistantTurnViewModel['deliveries'];
    expect(productDeliveryReferences(deliveries).map(({ reference }) => reference.id)).toEqual(['new-task']);
  });

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'zh' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useWorkspacePreviewStore.getState().setPath(null);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('does not render read-only query results in the delivery tail', () => {
    act(() => root.render(<MemoryRouter>{renderDelivery({ version: 2, operation: 'opened', presentation: {
      kind: 'table', truncated: true, items: [{ kind: 'task', id: 'task/one', title: '<img src=x>', status: 'ready', capabilities: ['open', 'run'] }],
    } })}</MemoryRouter>));
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-turn-tail]')).toBeNull();
    expect(container.textContent).not.toContain('<img src=x>');
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('does not render an empty query as a turn result', () => {
    act(() => root.render(<MemoryRouter>{renderDelivery({ version: 2, operation: 'opened', presentation: {
      kind: 'table', truncated: false, items: [],
    } })}</MemoryRouter>));

    expect(container.querySelector('[data-turn-tail]')).toBeNull();
    expect(container.textContent).not.toContain('没有匹配结果');
    expect(container.querySelector('table')).toBeNull();
  });

  it('does not mix read-only query results into a turn result', () => {
    const view: AssistantTurnViewModel = {
      answerContent: [],
      workLog: { items: [], active: false, status: 'completed', expandedByDefault: false, compact: false },
      answer: { started: true, showStreamingCursor: false },
      lifecycle: { state: 'completed' },
      outcome: undefined,
      deliveries: [
        { key: 'empty', delivery: { version: 2, operation: 'opened', presentation: { kind: 'table', truncated: false, items: [] } } },
        { key: 'result', delivery: { version: 2, operation: 'opened', presentation: { kind: 'table', truncated: false,
          items: [{ kind: 'note', id: 'note-1', title: 'Research note', capabilities: ['open'] }] } } },
      ],
      sources: [],
    };

    act(() => root.render(<MemoryRouter><AssistantResultTail view={view} /></MemoryRouter>));

    expect(container.textContent).not.toContain('Research note');
    expect(container.textContent).not.toContain('没有匹配结果');
    expect(container.querySelector('[data-turn-tail]')).toBeNull();
  });

  it('renders proposed replacements without applying them or rendering HTML', () => {
    act(() => root.render(<MemoryRouter>{renderDelivery({ version: 2, operation: 'opened', presentation: {
      kind: 'diff', title: 'Preview', truncated: false, edits: [{ from: 0, to: 5, text: '<script>unsafe()</script>' }],
    } })}</MemoryRouter>));
    expect(container.textContent).toContain('尚未应用');
    expect(container.querySelector('script')).toBeNull();
    act(() => container.querySelector('summary')!.click());
    expect(container.querySelector('details')?.open).toBe(true);
    expect(container.querySelector('pre')?.textContent).toBe('<script>unsafe()</script>');
    expect(container.querySelector('button')).toBeNull();
  });

  it('uses the borderless Note result row itself as the only action', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 2,
      operation: 'updated',
      primary: {
        kind: 'note',
        id: 'note-1',
        title: '财经新闻整理',
        capabilities: ['open', 'continue_in_chat'],
      },
    };

    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          <Routes>
            <Route
              path="*"
              element={(
                <>
                  {renderDelivery(delivery)}
                  <LocationProbe />
                </>
              )}
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain('财经新闻整理');
    expect(container.textContent).not.toContain('打开笔记');
    expect(container.textContent).not.toContain('在对话中继续');
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('[data-turn-tail]')).not.toBeNull();
    expect(container.querySelector('[data-turn-tail-tip]')).toBeNull();

    act(() => container.querySelector('button')?.click());
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(
      '/chat/session-1?note=note-1',
    );
  });

  it('presents an automation as a localized result row with a secondary continue action', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 2,
      operation: 'started',
      primary: {
        kind: 'automation',
        id: 'automation-1',
        title: 'Memory daily reconciliation',
        status: 'enabled',
        summary: 'Run deterministic daily_reconciliation without model inference.',
        capabilities: ['open', 'continue_in_chat'],
      },
    };

    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          {renderDelivery(delivery)}
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain('Memory daily reconciliation');
    expect(container.textContent).toContain('自动化');
    expect(container.textContent).toContain('已启用');
    expect(container.textContent).toContain('继续');
    expect(container.textContent).not.toContain('继续在对话中处理');
    expect(container.textContent).not.toContain('已就绪');
    expect(container.textContent).not.toContain('enabled');
    expect(container.querySelectorAll('button')).toHaveLength(2);
    expect(container.querySelector('[data-turn-tail]')).not.toBeNull();
  });

  it('presents a delegated task as one clear entry without raw runtime state or a second action', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 2,
      operation: 'started',
      primary: {
        kind: 'task', id: 'task-1', title: 'Research products', status: 'idle',
        capabilities: ['open', 'continue_in_chat'],
      },
    };
    act(() => root.render(<MemoryRouter>{renderDelivery(delivery)}</MemoryRouter>));
    expect(container.textContent).toContain('Research products');
    expect(container.textContent).toContain('已交办');
    expect(container.textContent).not.toContain('idle');
    expect(container.textContent).not.toContain('继续');
    expect(container.querySelectorAll('[data-product-delivery="task"] button')).toHaveLength(1);
  });

  it.each([
    ['queued', 'Starting soon', '即将开始'],
    ['running', 'In progress', '正在进行'],
    ['verifying', 'Checking the result', '正在核对结果'],
    ['waiting', 'Waiting', '暂时等待'],
    ['blocked', 'Needs attention', '需要处理'],
    ['completed', 'Completed', '已完成'],
  ])('updates the %s task status when the interface language changes', (status, en, zh) => {
    const delivery: ProductDeliveryEnvelope = {
      version: 2,
      operation: 'started',
      primary: {
        kind: 'task', id: `localized-${status}`, title: 'English Weekly Plan — One Page',
        status, capabilities: ['open'],
      },
    };
    useLocaleStore.setState({ language: 'en' });
    act(() => root.render(<MemoryRouter>{renderDelivery(delivery)}</MemoryRouter>));
    const row = container.querySelector('[data-product-delivery="task"]');
    expect(row?.textContent).toContain(en);
    expect(row?.textContent).not.toContain(zh);

    act(() => useLocaleStore.setState({ language: 'zh' }));
    expect(row?.textContent).toContain(zh);
    expect(row?.textContent).not.toContain(en);
    expect(row?.textContent).toContain('English Weekly Plan — One Page');

    act(() => useLocaleStore.setState({ language: 'en' }));
    expect(row?.textContent).toContain(en);
    expect(row?.textContent).not.toContain(zh);
  });

  it('opens a delegated task in the modal over the Personal AI conversation', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 2,
      operation: 'started',
      primary: { kind: 'task', id: 'task-1', title: 'Create an illustration', capabilities: ['open'] },
    };
    act(() => root.render(<MemoryRouter initialEntries={['/personal']}>
      <LocationProbe />
      {renderDelivery(delivery)}
    </MemoryRouter>));

    act(() => container.querySelector<HTMLButtonElement>('[data-product-delivery="task"] button')?.click());

    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/personal?task=task-1');
  });

  it('opens a generated Markdown file in the workspace preview', () => {
    const fileId = `space.${btoa('reports/personal-ai-2026-report.md').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    act(() => root.render(<MemoryRouter>{renderDelivery({
      version: 2,
      operation: 'updated',
      primary: { kind: 'file', id: fileId, title: 'personal-ai-2026-report.md', capabilities: ['preview'] },
    }, 'worker-session')}</MemoryRouter>));

    const button = container.querySelector<HTMLButtonElement>('[data-product-delivery="file"] button');
    expect(button?.disabled).toBe(false);
    act(() => button?.click());
    expect(useWorkspacePreviewStore.getState()).toMatchObject({
      path: 'reports/personal-ai-2026-report.md',
      conversationId: 'worker-session',
    });
  });

  it('does not render a read-only object below the assistant message', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 2,
      operation: 'opened',
      primary: {
        kind: 'project',
        id: 'project-1',
        title: 'today-cloud',
        status: 'active',
        capabilities: ['open', 'continue_in_chat'],
      },
    };

    act(() => {
      root.render(
        <MemoryRouter>
          {renderDelivery(delivery)}
        </MemoryRouter>,
      );
    });

    expect(container.textContent).not.toContain('today-cloud');
    expect(container.querySelector('[data-turn-tail]')).toBeNull();
  });

  it('keeps a visible boundary for failed deliveries', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 2,
      operation: 'failed',
      primary: {
        kind: 'automation',
        id: 'automation-1',
        title: 'Memory daily reconciliation',
        status: 'failed',
        capabilities: [],
      },
    };

    act(() => {
      root.render(
        <MemoryRouter>
          {renderDelivery(delivery)}
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain('失败');
    expect(container.querySelector('[data-turn-tail]')).not.toBeNull();
  });

  it('groups multiple resources under one tail with separated rows', () => {
    const first: ProductDeliveryEnvelope = {
      version: 2,
      operation: 'created',
      primary: { kind: 'task', id: 'task-1', title: '准备发布', capabilities: ['open'] },
    };
    const second: ProductDeliveryEnvelope = {
      version: 2,
      operation: 'created',
      primary: { kind: 'note', id: 'note-1', title: '发布说明', capabilities: ['open'] },
    };

    act(() => root.render(
      <MemoryRouter>
        <AssistantResultTail view={{
          answerContent: [],
          workLog: { items: [], active: false, status: 'completed', expandedByDefault: false, compact: false },
          answer: { started: true, showStreamingCursor: false },
          lifecycle: { state: 'completed' },
          outcome: undefined,
          deliveries: [
            { key: 'first', delivery: first },
            { key: 'second', delivery: second },
          ],
          sources: [],
        }} />
      </MemoryRouter>,
    ));

    expect(container.querySelectorAll('[data-turn-tail]')).toHaveLength(1);
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelectorAll('[data-turn-tail-tip]')).toHaveLength(0);
  });

  it('collapses multiple operated files behind a clickable file count', () => {
    const files: ProductDeliveryEnvelope[] = [
      { version: 2, operation: 'updated', primary: { kind: 'file', id: 'one', title: '.scrub_tmp.py', summary: '3512 bytes written', capabilities: [] } },
      { version: 2, operation: 'updated', primary: { kind: 'file', id: 'two', title: '.scan2_tmp.py', summary: '1392 bytes written', capabilities: [] } },
      { version: 2, operation: 'updated', primary: { kind: 'file', id: 'three', title: '.fts_tmp.py', summary: '2415 bytes written', capabilities: [] } },
    ];

    act(() => root.render(
      <MemoryRouter>
        <AssistantResultTail view={{
          answerContent: [],
          workLog: { items: [], active: false, status: 'completed', expandedByDefault: false, compact: false },
          answer: { started: true, showStreamingCursor: false },
          lifecycle: { state: 'completed' },
          outcome: undefined,
          deliveries: files.map((delivery, index) => ({ key: `file-${index}`, delivery })),
          sources: [],
        }} />
      </MemoryRouter>,
    ));

    const fileGroup = container.querySelector<HTMLDetailsElement>('[data-product-file-group] details');
    expect(fileGroup?.open).toBe(false);
    expect(fileGroup?.querySelector('summary')?.textContent).toContain('3 个文件');
    expect(fileGroup?.querySelectorAll('[data-product-delivery="file"]')).toHaveLength(3);

    act(() => fileGroup?.querySelector('summary')?.click());
    expect(fileGroup?.open).toBe(true);
  });

  it('shows outcome attachments once when they supersede matching file deliveries', () => {
    const files: ProductDeliveryEnvelope[] = [
      { version: 2, operation: 'updated', primary: { kind: 'file', id: 'file-one', title: 'index.html', capabilities: ['preview'] } },
      { version: 2, operation: 'updated', primary: { kind: 'file', id: 'file-two', title: 'app.js', capabilities: ['preview'] } },
    ];
    const view: AssistantTurnViewModel = {
      answerContent: [],
      workLog: { items: [], active: false, status: 'completed', expandedByDefault: false, compact: false },
      answer: { started: true, showStreamingCursor: false },
      lifecycle: { state: 'completed' },
      deliveries: files.map((delivery, index) => ({ key: `file-${index}`, delivery })),
      outcome: {
        version: 1,
        outcomeId: 'outcome-1',
        runId: 'run-1',
        turnId: 'turn-1',
        status: 'succeeded',
        deliverables: [
          { artifactId: 'snapshot-one', sourceFileId: 'file-one', title: 'index.html', kind: 'site', availability: 'available', location: 'workspace', capabilities: ['preview'], uri: 'xopc-file:file-one' },
          { artifactId: 'file-two', title: 'app.js', kind: 'file', availability: 'available', location: 'workspace', capabilities: ['preview'], uri: 'xopc-file:file-two' },
        ],
        evidence: [],
        createdAt: '2026-09-23T00:00:00Z',
      },
      sources: [],
    };

    act(() => root.render(<MemoryRouter><AssistantResultTail view={view} /></MemoryRouter>));

    expect(container.querySelectorAll('[data-product-file-group]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-result-attachment-group]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-result-attachment]')).toHaveLength(2);
    expect(container.querySelectorAll('summary')).toHaveLength(1);
    expect(container.querySelector('summary')?.textContent).toContain('2 个文件');
  });

  it('shows product objects and outcome files in the tail with generated images above it', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 2,
      operation: 'created',
      primary: { kind: 'task', id: 'task-1', title: '发布任务', capabilities: ['open'] },
    };
    const view: AssistantTurnViewModel = {
      answerContent: [],
      workLog: { items: [], active: false, status: 'completed', expandedByDefault: false, compact: false },
      answer: { started: true, showStreamingCursor: false },
      lifecycle: { state: 'completed' },
      deliveries: [{ key: 'delivery', delivery }],
      outcome: {
        version: 1,
        outcomeId: 'outcome-1',
        runId: 'run-1',
        turnId: 'turn-1',
        status: 'succeeded',
        createdAt: '2026-09-22T00:00:00Z',
        evidence: [],
        deliverables: [{
          artifactId: 'report',
          title: 'report.pdf',
          kind: 'pdf',
          availability: 'available',
          location: 'workspace',
          capabilities: ['preview'],
          uri: 'media://report.pdf',
        }],
      },
      attachments: [{ id: 'image', name: 'cover.png', type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }],
      sources: [],
    };

    act(() => root.render(<MemoryRouter><AssistantResultTail view={view} /></MemoryRouter>));

    expect(container.querySelectorAll('[data-turn-tail]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-result-attachment]')).toHaveLength(1);
    expect(container.querySelector('[data-result-attachment-group]')).toBeNull();
    expect(container.querySelector('img[alt="cover.png"]')).not.toBeNull();
    expect(container.textContent).toContain('发布任务');
    expect(container.textContent).toContain('report.pdf');
  });
});
