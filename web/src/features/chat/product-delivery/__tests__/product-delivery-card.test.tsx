// @vitest-environment jsdom

import type { ProductDeliveryEnvelope } from '@xopcai/gateway-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AssistantResultTail } from '@/features/chat/messages/assistant-result-tail';
import type { AssistantTurnViewModel } from '@/features/chat/messages/assistant-turn-view-model';
import { useLocaleStore } from '@/stores/locale-store';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderDelivery(delivery: ProductDeliveryEnvelope) {
  const view: AssistantTurnViewModel = {
    answerContent: [],
    workLog: { items: [], active: false, status: 'completed', expandedByDefault: false, compact: false },
    answer: { started: true, showStreamingCursor: false },
    lifecycle: { state: 'completed' },
    outcome: undefined,
    deliveries: [{ key: 'delivery-1', delivery }],
    sources: [],
  };
  return <AssistantResultTail view={view} />;
}

describe('AssistantResultTail product deliveries', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'zh' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders query results as a compact tail without table metadata', () => {
    act(() => root.render(<MemoryRouter>{renderDelivery({ version: 1, operation: 'opened', presentation: {
      kind: 'table', truncated: true, items: [{ kind: 'task', id: 'task/one', title: '<img src=x>', status: 'ready', capabilities: ['open', 'run'] }],
    } })}</MemoryRouter>));
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-turn-tail]')).not.toBeNull();
    expect(container.textContent).toContain('<img src=x>');
    expect(container.textContent).toContain('任务 · 已就绪');
    expect(container.textContent).not.toContain('task/one');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });

  it('does not render an empty query as a turn result', () => {
    act(() => root.render(<MemoryRouter>{renderDelivery({ version: 1, operation: 'opened', presentation: {
      kind: 'table', truncated: false, items: [],
    } })}</MemoryRouter>));

    expect(container.querySelector('[data-turn-tail]')).toBeNull();
    expect(container.textContent).not.toContain('没有匹配结果');
    expect(container.querySelector('table')).toBeNull();
  });

  it('does not mix an empty state into a turn that also has query results', () => {
    const view: AssistantTurnViewModel = {
      answerContent: [],
      workLog: { items: [], active: false, status: 'completed', expandedByDefault: false, compact: false },
      answer: { started: true, showStreamingCursor: false },
      lifecycle: { state: 'completed' },
      outcome: undefined,
      deliveries: [
        { key: 'empty', delivery: { version: 1, operation: 'opened', presentation: { kind: 'table', truncated: false, items: [] } } },
        { key: 'result', delivery: { version: 1, operation: 'opened', presentation: { kind: 'table', truncated: false,
          items: [{ kind: 'note', id: 'note-1', title: 'Research note', capabilities: ['open'] }] } } },
      ],
      sources: [],
    };

    act(() => root.render(<MemoryRouter><AssistantResultTail view={view} /></MemoryRouter>));

    expect(container.textContent).toContain('Research note');
    expect(container.textContent).not.toContain('没有匹配结果');
  });

  it('renders proposed replacements without applying them or rendering HTML', () => {
    act(() => root.render(<MemoryRouter>{renderDelivery({ version: 1, operation: 'opened', presentation: {
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
      version: 1,
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
      '/notes/note-1?returnTo=%2Fchat%2Fsession-1',
    );
  });

  it('presents an automation as a localized result row with a secondary continue action', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 1,
      operation: 'opened',
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

  it('keeps a visible boundary for failed deliveries', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 1,
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
      version: 1,
      operation: 'created',
      primary: { kind: 'task', id: 'task-1', title: '准备发布', capabilities: ['open'] },
    };
    const second: ProductDeliveryEnvelope = {
      version: 1,
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
      { version: 1, operation: 'updated', primary: { kind: 'file', id: 'one', title: '.scrub_tmp.py', summary: '3512 bytes written', capabilities: [] } },
      { version: 1, operation: 'updated', primary: { kind: 'file', id: 'two', title: '.scan2_tmp.py', summary: '1392 bytes written', capabilities: [] } },
      { version: 1, operation: 'updated', primary: { kind: 'file', id: 'three', title: '.fts_tmp.py', summary: '2415 bytes written', capabilities: [] } },
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
      { version: 1, operation: 'updated', primary: { kind: 'file', id: 'file-one', title: 'index.html', capabilities: ['preview'] } },
      { version: 1, operation: 'updated', primary: { kind: 'file', id: 'file-two', title: 'app.js', capabilities: ['preview'] } },
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

  it('combines product objects, outcome artifacts, and generated files in one tail', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 1,
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
    expect(container.querySelectorAll('[data-result-attachment]')).toHaveLength(2);
    const attachmentGroup = container.querySelector<HTMLDetailsElement>('[data-result-attachment-group] details');
    expect(attachmentGroup?.open).toBe(false);
    expect(attachmentGroup?.querySelector('summary')?.textContent).toContain('2 个文件');
    expect(container.textContent).toContain('发布任务');
    expect(container.textContent).toContain('report.pdf');
    expect(container.textContent).toContain('cover.png');

    act(() => attachmentGroup?.querySelector('summary')?.click());
    expect(attachmentGroup?.open).toBe(true);
  });
});
