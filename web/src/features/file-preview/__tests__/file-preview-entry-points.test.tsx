// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/preview-runtime/preview-runtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/preview-runtime/preview-runtime')>(),
  PreviewRuntimeView: () => null,
}));
vi.mock('@/features/sessions/session-api', () => ({
  getSessionDetail: vi.fn().mockResolvedValue({ projectId: 'project-a', routing: { agentId: 'agent-a' } }),
}));
vi.mock('@/features/preview-runtime/use-workspace-preview-state', () => ({
  useWorkspacePreviewState: () => ({
    descriptor: {
      id: 'workspace-file', fileName: 'report.html', type: 'html', mimeType: 'text/html',
      context: 'workspace', source: { kind: 'workspace', path: 'report.html' },
    },
    loading: false, loadError: null, textContent: '<h1>Report</h1>', binaryBuffer: null,
    fileResourceId: 'file-a', mtimeMs: null, saveStatus: 'idle', canDownload: true,
    sourceEditMode: false,
    recommendedOpenWithApps: [], recentOpenWithApps: [],
    setSourceEditMode: vi.fn(), onDownload: vi.fn(),
    createAttachmentFile: async () => new File(['<h1>Report</h1>'], 'report.html', { type: 'text/html' }),
  }),
}));

import { AttachmentPreviewDialog } from '@/features/chat/attachments/attachment-preview-dialog';
import { takeComposerAttachmentHandoff, resetComposerAttachmentHandoffsForTests } from '@/features/chat/composer/composer-attachment-handoff';
import { FilePreview } from '@/features/file-preview/file-preview';
import { WorkspaceTreeControlContext } from '@/features/right-workspace/workspace-context';
import { getSessionDetail } from '@/features/sessions/session-api';
import { WorkspaceFilePreviewPanel } from '@/features/workspace/workspace-file-preview-dialog';
import { SharePreviewPage } from '@/pages/share-preview-page';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function LocationProbe() {
  const location = useLocation();
  return <output data-location>{JSON.stringify(location)}</output>;
}

describe('common file preview header', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal('fetch', vi.fn(async (input: string) => input.endsWith('/meta')
      ? new Response(JSON.stringify({
        kind: 'file', fileName: 'report.html', fileSize: 15, mimeType: 'text/html',
        expiresAt: '2026-10-01T00:00:00Z', valid: true,
      }))
      : new Response('<h1>Report</h1>')));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetComposerAttachmentHandoffsForTests();
    vi.unstubAllGlobals();
  });

  it.each(['en', 'zh'] as const)('keeps the same HTML action order across workspace, attachment and public share (%s)', async (language) => {
    useLocaleStore.setState({ language });
    const labels = messages(language).workspace;
    const entries = [
      { name: 'workspace', editable: true, canChat: true, element: <WorkspaceFilePreviewPanel filePath="report.html" projectId="project-a" onClose={vi.fn()} /> },
      { name: 'attachment', editable: false, canChat: true, element: <AttachmentPreviewDialog open conversationId="session-a" attachment={{
        name: 'report.html', mimeType: 'text/html', data: btoa('<h1>Report</h1>'), uri: 'media://outbound/report.html',
      }} onClose={vi.fn()} /> },
      { name: 'share', editable: false, canChat: false, element: <Routes><Route path="/share/:token" element={<SharePreviewPage />} /></Routes> },
    ];
    for (const entry of entries) {
      await act(async () => root.render(<MemoryRouter key={entry.name} initialEntries={['/share/token-a']}>{entry.element}</MemoryRouter>));
      const title = document.querySelector('h2[title="report.html"]');
      expect(title).not.toBeNull();
      const row = title!.parentElement!.parentElement!;
      const buttons = [...row.querySelectorAll<HTMLButtonElement>('button')];
      expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
        labels.expandPreview, labels.moreActions, labels.close,
      ]);
      await act(async () => buttons.find(button => button.getAttribute('aria-label') === labels.moreActions)!.click());
      const menuItems = [...document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')];
      expect(menuItems.some(item => item.textContent === labels.expandPreview || item.textContent === labels.collapsePreview)).toBe(false);
      expect(menuItems.find((item) => item.textContent === labels.edit)?.disabled).toBe(!entry.editable);
      expect(menuItems.find((item) => item.textContent === labels.editInNewChat)?.disabled).toBe(!entry.canChat);
      expect(menuItems.find((item) => item.textContent === labels.shareLink)?.disabled).toBe(false);
      expect([...document.querySelectorAll('[role="menuitem"]')].filter((item) => item.textContent === labels.download)).toHaveLength(1);
      if (entry.name === 'share') {
        expect(document.querySelector('a[role="menuitem"]')?.getAttribute('href')).toContain('/s/token-a?inline=1');
      }
    }
  });

  it.each(['workspace', 'attachment'] as const)('expands %s only inside the content surface and leaves navigation usable', async (entry) => {
    useLocaleStore.setState({ language: 'en' });
    const navigate = vi.fn();
    await act(async () => root.render(<MemoryRouter>
      <nav><button onClick={navigate}>Navigation</button></nav>
      <div className="app-main-surface relative">
        {entry === 'workspace' ? <WorkspaceFilePreviewPanel filePath="report.html" projectId="project-a" onClose={vi.fn()} />
          : <AttachmentPreviewDialog embedded open conversationId="session-a" attachment={{ name: 'report.html', mimeType: 'text/html', data: btoa('<h1>Report</h1>') }} onClose={vi.fn()} />}
      </div>
    </MemoryRouter>));
    const labels = messages('en').workspace;
    const expand = container.querySelector<HTMLButtonElement>(`button[aria-label="${labels.expandPreview}"]`)!;
    expect(expand.textContent).toBe('');
    expect(expand.querySelector('svg')).not.toBeNull();
    expect(expand.disabled).toBe(false);
    await act(async () => expand.click());
    const expanded = container.querySelector<HTMLElement>('[data-file-preview-expanded]')!;
    expect(expanded).not.toBeNull();
    expect(expanded.parentElement).toBe(container.querySelector('.app-main-surface'));
    expect(expanded.classList.contains('absolute')).toBe(true);
    expect(expanded.classList.contains('w-screen')).toBe(false);
    expect(expanded.contains(container.querySelector('nav'))).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>('nav button')!.click());
    expect(navigate).toHaveBeenCalledOnce();
    const collapse = container.querySelector<HTMLButtonElement>(`button[aria-label="${labels.collapsePreview}"]`)!;
    expect(collapse.textContent).toBe('');
    await act(async () => collapse.click());
    expect(container.querySelector('[data-file-preview-expanded]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${labels.expandPreview}"]`)!.click());
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
    expect(container.querySelector('[data-file-preview-expanded]')).toBeNull();
    expect(container.querySelector('h2[title="report.html"]')).not.toBeNull();
  });

  it('shows the workspace path and exposes the tree and system open actions directly', async () => {
    useLocaleStore.setState({ language: 'en' });
    const toggleTree = vi.fn();
    const openFile = vi.fn();
    await act(async () => root.render(<MemoryRouter>
      <WorkspaceTreeControlContext.Provider value={{ button: null, label: 'Hide file tree', active: true, onToggle: toggleTree }}>
        <FilePreview language="en"
          descriptor={{ id: 'nested-file', context: 'workspace', fileName: 'browser.ts', mimeType: 'text/typescript', type: 'code', source: { kind: 'workspace', path: 'project/src/browser.ts' } }}
          loading={false} loadError={null} textContent="export {};" binaryBuffer={null}
          actions={{ canDownload: true, onDownload: vi.fn() }}
          header={{ expanded: false, onClose: vi.fn(), openWithSystemApp: { onClick: openFile } }}
        />
      </WorkspaceTreeControlContext.Provider>
    </MemoryRouter>));
    expect(container.querySelector('[title="project/src/browser.ts"]')?.textContent).toBe('projectsrcbrowser.ts');
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Hide file tree"]')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[role="menu"]')).toBeNull();
    await act(async () => toggle.click());
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${messages('en').workspace.openSystemApp}"]`)!.click());
    expect(toggleTree).toHaveBeenCalledOnce();
    expect(openFile).toHaveBeenCalledOnce();
  });

  it('uses the common chat action to hand off the file and its source project', async () => {
    useLocaleStore.setState({ language: 'en' });
    const file = new File(['original bytes'], 'report.html', { type: 'text/html' });
    const onClose = vi.fn();
    await act(async () => root.render(<MemoryRouter>
      <FilePreview
        language="en"
        descriptor={{ id: 'attachment-a', context: 'attachment', fileName: file.name, mimeType: file.type, type: 'html', source: { kind: 'inline' } }}
        loading={false} loadError={null} textContent="original bytes" binaryBuffer={null}
        actions={{ canDownload: true, onDownload: vi.fn() }}
        header={{ expanded: false, onClose }}
        chat={{ createFile: async () => file, conversationId: 'source-session' }}
      />
      <LocationProbe />
    </MemoryRouter>));
    await act(async () => document.querySelector<HTMLButtonElement>(`[aria-label="${messages('en').workspace.moreActions}"]`)?.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')]
      .find((item) => item.textContent === messages('en').workspace.editInNewChat)?.click());
    const location = JSON.parse(container.querySelector('[data-location]')!.textContent) as { pathname: string; search: string; state: { agentId: string } };
    expect(location.pathname).toBe('/chat/new');
    const params = new URLSearchParams(location.search);
    expect(params.get('projectId')).toBe('project-a');
    expect(takeComposerAttachmentHandoff(params.get('attachmentHandoff')!)).toBe(file);
    expect(location.state.agentId).toBe('agent-a');
    expect(getSessionDetail).toHaveBeenCalledWith('source-session');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
