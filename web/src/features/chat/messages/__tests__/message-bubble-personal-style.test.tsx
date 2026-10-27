// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageBubble } from '@/features/chat/messages/message-bubble';
import type { Message } from '@/features/chat/messages/messages.types';
import * as workspaceApi from '@/features/workspace/workspace-api';
import { useLocaleStore } from '@/stores/locale-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

describe('Personal AI message styling', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'en' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    useWorkspacePreviewStore.getState().setPath(null);
    vi.restoreAllMocks();
    act(() => root.unmount());
    container.remove();
  });

  function render(message: Message, personal: boolean, isStreaming: boolean) {
    act(() => root.render(
      <MemoryRouter>
        <MessageBubble message={message} personal={personal} isStreaming={isStreaming} progress={null} conversationId="personal-chat" />
      </MemoryRouter>,
    ));
  }

  it('opens personal task result links using their producing run', async () => {
    const resolveFile = vi.spyOn(workspaceApi, 'resolveWorkspaceFileReference').mockResolvedValue({
      inputPath: 'report.html', displayName: 'report.html', scope: 'external', exists: true,
      absolutePath: '/worker/report.html', capabilities: ['preview'],
    });
    render({ role: 'assistant', content: [{ type: 'text', text: '[HTML](xopc://workspace/file?path=report.html)' }],
      taskResultDelivery: { taskRunId: 'producing-run' } as never }, true, false);
    await act(async () => { container.querySelector<HTMLAnchorElement>('a')?.click(); });
    expect(resolveFile).toHaveBeenCalledWith('report.html', expect.objectContaining({ taskRunId: 'producing-run' }));
  });

  function taskReply(deliverables: NonNullable<Message['outcome']>['deliverables'] = []): Message {
    return {
      role: 'assistant', content: [{ type: 'text', text: 'Here is the answer.' }],
      taskResultDelivery: {
        version: 1, deliveryId: 'reply:result', taskId: 'task', taskRunId: 'worker',
        taskTitle: 'Tomorrow’s exhibitions', conversationId: 'personal-chat',
        originTranscriptId: 'transcript', assignmentEpoch: 0, resultRevision: 2, createdAt: 1,
        outcome: { version: 1, outcomeId: 'outcome', runId: 'worker', turnId: 'worker',
          status: 'succeeded', deliverables, evidence: [], createdAt: '2026-10-17T00:00:00Z' },
      },
    };
  }

  it('keeps personal conversation replies free of task references and result versions', () => {
    render(taskReply(), true, false);
    expect(container.textContent).toContain('Here is the answer.');
    expect(container.querySelector('[data-result-follow-up]')).toBeNull();
    expect(container.querySelector('[data-result-revision]')).toBeNull();
    expect(container.querySelector('[data-result-attachment]')).toBeNull();
  });

  it('shows a generated report card and reveals its version only in the preview details', async () => {
    render(taskReply([{ artifactId: 'report', title: 'Exhibition report.pdf', kind: 'pdf',
      availability: 'available', location: 'artifact_store', capabilities: ['preview'],
      uri: 'media://outbound/report.pdf', mimeType: 'application/pdf' }]), true, false);
    const card = container.querySelector<HTMLButtonElement>('[data-result-attachment] button');
    expect(card?.textContent).toContain('Exhibition report.pdf');
    expect(container.querySelector('[data-result-follow-up]')).toBeNull();
    expect(document.querySelector('[data-result-revision]')).toBeNull();
    await act(async () => card?.click());
    expect(document.querySelector('[role="dialog"] [data-result-revision]')?.textContent)
      .toBe('Result version 2');
  });

  it('passes the result version into workspace file details and clears it for other files', () => {
    render(taskReply([{ artifactId: 'report', title: 'Report.md', kind: 'document',
      availability: 'available', location: 'workspace', capabilities: ['preview'],
      workspaceRelativePath: 'Report.md' }]), true, false);
    act(() => container.querySelector<HTMLButtonElement>('[data-result-attachment] button')?.click());
    expect(useWorkspacePreviewStore.getState()).toMatchObject({
      path: 'Report.md', conversationId: 'personal-chat', resultRevision: 2,
    });
    useWorkspacePreviewStore.getState().setPath('Other.md');
    expect(useWorkspacePreviewStore.getState().resultRevision).toBeUndefined();
  });

  it('preserves task follow-up controls outside personal conversations', () => {
    render(taskReply(), false, false);
    expect(container.querySelector('[data-result-follow-up]')?.textContent).toContain('Ask about:');
  });

  it('uses consistent rounded corners for Personal AI and regular user bubbles', () => {
    const message: Message = { role: 'user', content: [{ type: 'text', text: 'Hello' }] };
    render(message, true, false);
    expect(container.querySelector('.chat-user-message')?.classList.contains('rounded-2xl')).toBe(true);
    expect(container.querySelector('.chat-user-message')?.classList.contains('rounded-tr-sm')).toBe(false);

    render(message, false, false);
    expect(container.querySelector('.chat-user-message')?.classList.contains('rounded-2xl')).toBe(true);
    expect(container.querySelector('.chat-user-message')?.classList.contains('rounded-tr-sm')).toBe(false);
  });

  it('shows the waiting bubble until an assistant answer starts', () => {
    render({ role: 'assistant', content: [], pendingResponseStatus: 'waiting' }, true, true);
    expect(container.querySelector('[data-status-phase="waiting"]')).not.toBeNull();
    expect(container.querySelector('.xopc-personal-thinking')).toBeNull();

    render({ role: 'assistant', content: [{ type: 'text', text: 'Hello back' }] }, true, true);
    expect(container.querySelector('.xopc-personal-thinking')).toBeNull();
    const cursor = container.querySelector('[data-chat-streaming-cursor]');
    expect(cursor).not.toBeNull();
    expect(cursor?.classList.contains('animate-pulse')).toBe(false);

    render({ role: 'assistant', content: [] }, false, true);
    expect(container.querySelector('.xopc-personal-thinking')).toBeNull();
  });

  it('groups live Personal narration and keeps it inspectable after completion', () => {
    const opening: Message = { role: 'assistant', content: [{ type: 'text', text: '我先核对论文里的数值。', segmentId: 'first', presentation: 'pending' }] };
    render(opening, true, true);
    expect(container.querySelector('.assistant-markdown-content')?.textContent).toContain('我先核对论文里的数值。');
    expect(container.querySelector('.xopc-personal-thinking')).toBeNull();
    render({ ...opening, content: [{ type: 'text', text: '我先核对论文里的数值。', segmentId: 'first', presentation: 'narration' },
      { type: 'text', text: '这项结果检验的是轨道衰减。', presentation: 'answer' }] }, true, false);
    expect(container.querySelector('.assistant-markdown-content')?.textContent).not.toContain('我先核对论文里的数值。');
    expect(container.textContent).toContain('这项结果检验的是轨道衰减。');
    render({ ...opening, content: [{ type: 'text', text: '我先核对论文里的数值。', presentation: 'narration' }] }, true, false);
    expect(container.querySelector('[data-assistant-work-log] button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false');
    act(() => container.querySelector<HTMLButtonElement>('[data-assistant-work-log] button[aria-expanded]')?.click());
    expect(container.querySelector('[data-assistant-activity-flow]')?.textContent).toContain('我先核对论文里的数值。');
  });

  it('does not reveal a fragmented silent-reply marker in the Personal conversation', () => {
    for (const text of ['N', 'NO_', 'NO_REPLY']) {
      render({ role: 'assistant', content: [{ type: 'text', text, presentation: 'pending' }] }, true, true);
      expect(container.querySelector('.assistant-markdown-content')).toBeNull();
    }
    render({ role: 'assistant', content: [{ type: 'text', text: 'No problem.', presentation: 'pending' }] }, true, true);
    expect(container.querySelector('.assistant-markdown-content')?.textContent?.trim()).toBe('No problem.');
    render({ role: 'assistant', content: [{ type: 'text', text: 'NO_REPLY', presentation: 'answer' }] }, true, false);
    expect(container.querySelector('.assistant-markdown-content')).toBeNull();
  });
});
