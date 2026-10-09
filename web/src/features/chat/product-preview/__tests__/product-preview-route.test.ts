import { describe, expect, it } from 'vitest';

import { noteDetailHref, closeNotePreviewModalHref } from '@/features/notes/note-detail-route';
import { isChatPreviewPath } from '@/lib/chat-preview-origin';

import { chatProductHref, closeProductPreviewHref, resolveProductPreviewTarget } from '../product-preview-route';

const background = '/chat/session-1?view=full';

describe('chat product preview navigation', () => {
  it.each([
    ['/projects/project-1', 'project'],
    ['/workflows/runs/run-1?agentId=coder', 'workflow_run'],
    ['/workflows?run=run-1&agent=coder', 'workflow_run'],
    ['/workflows?def=research', 'workflow_definition'],
    ['/workflows/research', 'workflow_definition'],
    ['/automations?automation=automation-1', 'automation'],
    ['/local-apps/app-1', 'local_app'],
    ['/open?kind=local_app&id=app-1', 'local_app'],
  ])('keeps chat mounted for viewing %s', (href, kind) => {
    const opened = new URL(chatProductHref(background, href), 'https://xopc.local');
    expect(opened.pathname).toBe('/chat/session-1');
    expect(opened.searchParams.get('view')).toBe('full');
    expect(resolveProductPreviewTarget(opened.searchParams.get('preview')!)?.kind).toBe(kind);
    expect(closeProductPreviewHref(opened.pathname, opened.search)).toBe(background);
  });

  it('preserves run ownership and project scope when normalizing older links', () => {
    expect(resolveProductPreviewTarget('/workflows?run=run%2F1&agent=coder&projectId=p1')).toMatchObject({
      id: 'run/1', ownerAgentId: 'coder', href: '/workflows/runs/run%2F1?projectId=p1&agentId=coder',
    });
  });

  it.each([
    '/settings/capabilities/models', '/settings/agent-browser', '/capabilities/skills', '/capabilities/agents/coder',
    '/chat/other', '/chat/new', '/workflows/new', '/workflows/research/edit', '/workflows?def=research&copy=1',
    '/projects/project-1/settings', '/extensions/app-1', '/automations?action=new', '/scenes/scene-1',
  ])('keeps intentional page navigation for %s', (href) => {
    expect(chatProductHref(background, href)).toBe(href);
  });

  it('recognizes Personal AI as a conversation preview origin', () => {
    expect(isChatPreviewPath('/personal')).toBe(true);
    expect(isChatPreviewPath('/settings/personal')).toBe(false);
    expect(isChatPreviewPath('/personal-settings')).toBe(false);
    const noteHref = noteDetailHref('/personal?view=full', 'n1');
    expect(noteHref).toBe('/personal?view=full&note=n1');
    const noteUrl = new URL(noteHref, 'https://xopc.local');
    expect(closeNotePreviewModalHref(noteUrl.pathname, noteUrl.search)).toBe('/personal?view=full');
    const projectHref = chatProductHref('/personal?view=full', '/projects/p1');
    const projectUrl = new URL(projectHref, 'https://xopc.local');
    expect(projectUrl.pathname).toBe('/personal');
    expect(closeProductPreviewHref(projectUrl.pathname, projectUrl.search)).toBe('/personal?view=full');
  });

  it('keeps Personal AI settings navigation on a page', () => {
    expect(chatProductHref('/personal', '/settings/capabilities/models')).toBe('/settings/capabilities/models');
  });

  it('does not modalize viewing from outside chat', () => {
    expect(chatProductHref('/projects', '/workflows/runs/r1')).toBe('/workflows/runs/r1');
  });

  it('replaces the current preview instead of stacking overlays', () => {
    const href = chatProductHref('/chat/c1?task=t1&note=n1&preview=old', '/projects/p1');
    const params = new URL(href, 'https://xopc.local').searchParams;
    expect(params.get('task')).toBeNull();
    expect(params.get('note')).toBeNull();
    expect(params.get('preview')).toBe('/projects/p1');
  });

  it.each(['//example.com/projects/p1', '/workflows/%ZZ', '/projects/p1#edit'])('rejects invalid preview targets: %s', (href) => {
    expect(resolveProductPreviewTarget(href)).toBeNull();
  });
});
