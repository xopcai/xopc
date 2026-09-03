// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

vi.mock('../attachment-tile', () => ({
  AttachmentTile: ({ attachment, onOpen }: { attachment: MessageAttachment; onOpen: (attachment: MessageAttachment) => void }) => (
    <button onClick={() => onOpen(attachment)}>{attachment.name}</button>
  ),
}));
vi.mock('../attachment-preview-dialog', () => ({
  AttachmentPreviewDialog: ({ open }: { open: boolean }) => open ? <div role="dialog" /> : null,
}));

import { AttachmentRenderer } from '../attachment-renderer';
import { TurnOutcomeResult } from '@/features/chat/messages/turn-outcome-result';
import type { TurnOutcome } from '@xopcai/gateway-contract';

describe('file preview entry points', () => {
  let container: HTMLDivElement;
  let root: Root;
  const file: MessageAttachment = {
    id: 'report', name: 'report.md', mimeType: 'text/markdown',
    uri: 'media://outbound/report.md', workspaceRelativePath: 'output/report.md',
  };
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useWorkspacePreviewStore.getState().setPath(null);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useWorkspacePreviewStore.getState().setPath(null);
  });

  it('opens AI deliverables in the workspace preview with their source session', () => {
    const outcome: TurnOutcome = {
      version: 1, outcomeId: 'outcome-1', runId: 'run-1', turnId: 'turn-1',
      createdAt: '2026-09-03T00:00:00Z', status: 'succeeded', evidence: [],
      deliverables: [{
        artifactId: 'report', title: 'report.md', kind: 'document',
        availability: 'available', location: 'workspace', capabilities: ['preview', 'download'],
        uri: file.uri, workspaceRelativePath: file.workspaceRelativePath,
      }],
    };
    act(() => root.render(<TurnOutcomeResult outcome={outcome} sessionKey="session-a" projectId="project-a" />));
    act(() => container.querySelector<HTMLButtonElement>('button')?.click());
    expect(useWorkspacePreviewStore.getState()).toMatchObject({ path: 'output/report.md', sessionKey: 'session-a', projectId: 'project-a' });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('uses the same workspace preview for generated message attachments', () => {
    act(() => root.render(<AttachmentRenderer attachments={[file]} sessionKey="session-b" />));
    act(() => container.querySelector<HTMLButtonElement>('button')?.click());
    expect(useWorkspacePreviewStore.getState()).toMatchObject({ path: 'output/report.md', sessionKey: 'session-b' });
    act(() => useWorkspacePreviewStore.getState().setPath('another.md'));
    expect(useWorkspacePreviewStore.getState().sessionKey).toBeNull();
  });

  it.each([
    { layout: 'user' as const, attachment: file, sessionKey: 'session-a' },
    { layout: 'assistant' as const, attachment: { ...file, workspaceRelativePath: undefined }, sessionKey: 'session-a' },
    { layout: 'assistant' as const, attachment: file, sessionKey: undefined },
  ])('keeps media attachments in the attachment preview when workspace scope is unavailable', ({ layout, attachment, sessionKey }) => {
    act(() => root.render(<AttachmentRenderer attachments={[attachment]} layout={layout} sessionKey={sessionKey} />));
    act(() => container.querySelector<HTMLButtonElement>('button')?.click());
    expect(useWorkspacePreviewStore.getState().path).toBeNull();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
