import * as Popover from '@radix-ui/react-popover';
import { PanelRight, Copy, Globe, FileText, FolderOpen, ListTree, Maximize2, MessageSquare, Minimize2, MoreHorizontal, Plus, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation } from 'react-router-dom';

import { SlidingTabList } from '@/components/ui/sliding-tab-list';
import { BrowserTabView, useBrowserEvents } from '@/features/browser/browser-tab';
import { closeEmbeddedBrowser, useEmbeddedBrowserStore } from '@/features/browser/browser-store';
import { WorkspaceColumn } from '@/components/shell/workspace-column';
import { AttachmentPreviewDialog } from '@/features/chat/attachments/attachment-preview-dialog';
import { SideChatColumn } from '@/features/side-chat/side-chat-column';
import { WorkspaceFilePreviewPanel } from '@/features/workspace/workspace-file-preview-dialog';
import { detectPreviewFileType } from '@/features/preview-runtime/detect-preview-file';
import { electronPreviewViewportClass } from '@/lib/electron-window-chrome';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { EMPTY_WORKSPACE_PANE, useRightWorkspaceStore, type FileTab } from '@/stores/right-workspace-store';
import { useSideChatStore } from '@/stores/side-chat-store';
import { useTerminalPanelStore } from '@/stores/terminal-panel-store';
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';
import { useWorkspaceNavigation } from './workspace-navigation';
import { useWorkspaceMotion } from './use-workspace-motion';
import { useWorkspaceTreeInset } from './use-workspace-tree-inset';
import { WorkspaceStartPage } from './workspace-start-page';
import { canCloseFile } from './file-close-guards';
import { WorkspaceFileTargetsContext, WorkspaceOwnerContext, WorkspaceTreeControlContext } from './workspace-context';

const buttonClass = 'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

function navigateMenu(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[index]?.focus();
}

export function RightWorkspace({ scope, enabled = true, elevated = false, onDockedWidthChange }: { scope: string; enabled?: boolean; elevated?: boolean; onDockedWidthChange?: (width: number) => void }) {
  const zh = useLocaleStore((s) => s.language) === 'zh';
  const panes = useRightWorkspaceStore((s) => s.panes);
  const pane = panes[scope] ?? EMPTY_WORKSPACE_PANE;
  const active = pane.tabs.find((tab) => tab.id === pane.activeId);
  const browserUrl = useEmbeddedBrowserStore((s) => active?.kind === 'browser' ? s.tabs[active.id]?.url : undefined);
  const width = useRightWorkspaceStore((s) => s.width);
  const treeWidth = useRightWorkspaceStore((s) => s.treeWidth);
  const fileTreeOpen = useRightWorkspaceStore((s) => s.fileTreeOpen);
  const sideTreeOpen = useRightWorkspaceStore((s) => s.sideTreeOpen);
  const notice = useRightWorkspaceStore((s) => s.notices[scope]);
  const fileStatus = useRightWorkspaceStore((s) => s.fileStatus);
  const sideTabs = useSideChatStore((s) => s.tabs);
  const pending = useSideChatStore((s) => s.pendingCreate);
  const creating = useSideChatStore((s) => s.creatingRequests[scope]);
  const token = useGatewayStore((s) => s.conversationId);
  const { search } = useLocation();
  const panelRef = useRef<HTMLElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(1200);
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const [resizing, setResizing] = useState(false);
  const [treeOverlay, setTreeOverlay] = useState(false);
  const treeOverlayInset = useWorkspaceTreeInset(panelRef, treeOverlay, pane.activeId);
  const [browserTreeOpen, setBrowserTreeOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [browserError, setBrowserError] = useState('');
  const [saveFailed, setSaveFailed] = useState<string | null>(null);
  const [discardRequested, setDiscardRequested] = useState(false);
  const store = useRightWorkspaceStore.getState();
  const visible = enabled && pane.open;
  const present = useWorkspaceMotion(panelRef, visible, pane.activeId);
  useLayoutEffect(() => {
    if (!visible && panelRef.current?.contains(document.activeElement)) {
      document.querySelector<HTMLElement>('[data-workspace-trigger]')?.focus();
    }
  }, [visible]);
  const single = available < 840;
  const treePreference = active?.kind === 'browser' ? browserTreeOpen : active?.kind === 'sidechat' ? sideTreeOpen : fileTreeOpen;
  const panelWidth = active ? Math.max(460, Math.min(width || available * 0.6, available - 380)) : 320;
  useLayoutEffect(() => {
    onDockedWidthChange?.(visible && !single && !expanded ? panelWidth : 0);
  }, [expanded, onDockedWidthChange, panelWidth, single, visible]);
  const treeHome = !active || active.kind === 'files';
  const treeVisible = treeHome || ((active.kind === 'file' || active.kind === 'sidechat' || active.kind === 'browser') && treePreference && ((single || expanded) ? available : panelWidth) >= 460 + treeWidth);
  const treeShown = treeVisible || treeOverlay;
  const file = active?.kind === 'file' ? active : undefined;
  const treeScope = useMemo(() => ({
    conversationId: file?.path ? file.conversationId : scope !== 'new' ? scope : undefined,
    projectId: file?.path ? file.projectId : new URLSearchParams(search).get('projectId') ?? undefined,
    agentId: file?.agentId,
  }), [file?.agentId, file?.conversationId, file?.path, file?.projectId, scope, search]);
  const treeKey = JSON.stringify(treeScope);
  const [trees, setTrees] = useState<Record<string, typeof treeScope>>({});
  useLayoutEffect(() => {
    store.setScope(scope);
  }, [scope, store]);
  useEffect(() => {
    if (visible) setTrees((current) => current[treeKey] ? current : { ...current, [treeKey]: treeScope });
  }, [treeKey, treeScope, visible]);
  useLayoutEffect(() => {
    const parent = panelRef.current?.parentElement;
    if (!parent) return;
    const update = () => setAvailable(parent.clientWidth || window.innerWidth);
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(parent);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  useEffect(() => {
    const missingScopes = new Set(sideTabs.map((t) => t.parentConversationId).filter((owner) => !useRightWorkspaceStore.getState().panes[owner]));
    for (const tab of sideTabs) {
      if (!useRightWorkspaceStore.getState().panes[tab.parentConversationId]?.tabs.some((t) => t.id === `side:${tab.id}`)) {
        store.addSideChat(tab.id, tab.title, tab.parentConversationId, false);
      }
    }
    for (const owner of missingScopes) {
      const legacy = useSideChatStore.getState().panes[owner];
      if (legacy?.open) store.activate(legacy.activeId ? `side:${legacy.activeId}` : null, owner);
    }
  }, [sideTabs, store]);
  const migratedPanel = useRef(false);
  useEffect(() => {
    if (migratedPanel.current) return;
    migratedPanel.current = true;
    if (!useRightWorkspaceStore.getState().panes[scope] && useWorkspacePanelStore.getState().open) store.setOpen(true, scope);
  }, [scope, store]);
  useEffect(() => { setTreeOverlay(false); }, [pane.activeId, scope]);
  useEffect(() => { setSaveFailed(null); setDiscardRequested(false); setBrowserError(''); }, [scope]);
  useEffect(() => {
    const node = tabListRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [available, expanded, pane.activeId]);
  useEffect(() => {
    useWorkspacePreviewStore.setState({ path: file?.path ?? null, projectId: file?.projectId ?? null, conversationId: file?.conversationId ?? null, line: file?.line ?? null });
  }, [file]);
  useEffect(() => {
    const closeMenu = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { if (menu || moreOpen) return; if (discardRequested) { event.preventDefault(); setDiscardRequested(false); return; } if (expanded || treeOverlay) { event.preventDefault(); setExpanded(false); setTreeOverlay(false); } } };
    window.addEventListener('keydown', closeMenu);
    return () => window.removeEventListener('keydown', closeMenu);
  }, [discardRequested, expanded, menu, moreOpen, treeOverlay]);

  useWorkspaceNavigation(scope, pane, enabled);
  useBrowserEvents();

  async function closeBrowser(id: string) {
    if (closing) return;
    setClosing(id);
    setBrowserError('');
    try { if (await closeEmbeddedBrowser(id)) store.remove(id, scope); }
    catch (error) { setBrowserError(error instanceof Error ? error.message : String(error)); }
    finally { setClosing(null); }
  }
  async function closeFile(id: string, discard = false) {
    if (closing) return;
    setClosing(id);
    try {
      if (!discard && !await canCloseFile(id)) { setSaveFailed(id); return; }
      store.remove(id, scope);
      setSaveFailed(null);
      setDiscardRequested(false);
    } finally { setClosing(null); }
  }
  function tabTitle(tab: (typeof pane.tabs)[number]) {
    if (tab.kind === 'home') return zh ? '新标签页' : 'New tab';
    if (tab.kind === 'browser' && tab.title === 'Browser') return zh ? '浏览器' : 'Browser';
    if (tab.kind === 'files') return zh ? '文件' : 'Files';
    return tab.title === 'Side chat' ? (zh ? '侧聊' : 'Side chat') : tab.title;
  }
  function select(id: string) {
    store.activate(id, scope);
  }
  function toggleTree() {
    if (!active) return;
    if (treeOverlay) setTreeOverlay(false);
    else if (!treeVisible && (single || (!expanded && panelWidth < 460 + treeWidth))) setTreeOverlay(true);
    else if (active.kind === 'browser') setBrowserTreeOpen(!browserTreeOpen);
    else store.setTreeOpen(active.kind === 'sidechat' ? 'sidechat' : 'file', !treePreference);
  }
  const treeControl = active && !treeHome && active.kind !== 'home' ? <button type="button" className={buttonClass} aria-label={zh ? '切换文件树' : 'Toggle file tree'} aria-pressed={treeShown} onClick={toggleTree}><FolderOpen className="size-4" aria-hidden /></button> : null;
  function closeCurrent() {
    if (!active) return;
    if (active.kind === 'file') void closeFile(active.id);
    else if (active.kind === 'browser') void closeBrowser(active.id);
    else if (active.kind === 'sidechat') window.dispatchEvent(new CustomEvent('workspace-close-sidechat', { detail: active.sideChatId }));
    else store.remove(active.id, scope);
  }
  function drag(event: ReactPointerEvent<HTMLDivElement>, tree = false) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = tree ? treeWidth : panelWidth;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    setResizing(true);
    let committed = startWidth;
    const move = (e: PointerEvent) => {
      const value = startWidth + startX - e.clientX;
      committed = tree ? Math.max(200, Math.min(320, panelWidth - 460, value)) : Math.max(460, Math.min(available - 380, value));
      const node = tree ? panelRef.current?.querySelector<HTMLElement>('[data-workspace-tree]') : panelRef.current;
      if (node) node.style.width = `${committed}px`;
    };
    const stop = () => {
      if (tree) store.setTreeWidth(committed); else store.setWidth(committed);
      dragCleanup.current = null;
      setResizing(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    dragCleanup.current?.();
    dragCleanup.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }
  const sideParents = [...new Set([...sideTabs.map((t) => t.parentConversationId), ...(pending ? [pending.parentConversationId] : []), ...(scope !== 'new' ? [scope] : [])])];
  const allFiles = Object.entries(panes).flatMap(([owner, p]) => p.tabs.filter((t): t is FileTab => t.kind === 'file').map((tab) => ({ owner, tab })));

  const retainedFiles = new Set([...allFiles].sort((a, b) => b.tab.visitedAt - a.tab.visitedAt).slice(0, 8).map(({ tab }) => tab.id));

  return <aside id="app-workspace-panel" ref={panelRef} aria-label={zh ? '文件与侧聊工作区' : 'Files and side chats'} data-right-workspace aria-hidden={!visible} inert={!visible}
    className={cn('relative min-h-0 shrink-0 flex-col overflow-hidden border-l border-edge bg-surface-panel', present ? 'flex' : 'hidden',
      present && (single || expanded) && 'fixed inset-0', present && (single || expanded) && electronPreviewViewportClass(), elevated ? 'z-[110]' : 'z-40')}
    style={{ width: single || expanded ? undefined : panelWidth }}>
    {!single && !expanded && active ? <div role="separator" aria-orientation="vertical" tabIndex={0} aria-label={zh ? '调整工作区宽度' : 'Resize workspace'} aria-valuemin={460} aria-valuemax={Math.max(460, available - 380)} aria-valuenow={Math.round(panelWidth)}
      className="absolute left-0 top-0 z-20 h-full w-2 -translate-x-1/2 cursor-col-resize touch-none focus-visible:bg-accent/30" onPointerDown={(e) => drag(e)}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); store.setWidth(Math.max(460, Math.min(available - 380, panelWidth + (e.key === 'ArrowLeft' ? 20 : -20)))); } if (e.key === 'Home') store.setWidth(0); }} /> : null}
    {resizing ? <div data-browser-occluder className="fixed inset-0 z-[120] cursor-col-resize" /> : null}
    <div data-workspace-tab-bar className="flex h-14 shrink-0 items-center gap-1 border-b border-edge-subtle bg-surface-base/80 px-2">
      <Popover.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <Popover.Trigger asChild><button className={buttonClass} aria-label={zh ? '工作区更多操作' : 'Workspace actions'}><MoreHorizontal className="size-4" aria-hidden /></button></Popover.Trigger>
        <Popover.Portal><Popover.Content align="start" sideOffset={8} role="menu" onKeyDown={navigateMenu} aria-label={zh ? '工作区操作' : 'Workspace operations'} className="workspace-menu z-[125] w-64 rounded-xl border border-edge bg-surface-panel p-1.5 text-sm shadow-popover">
          {window.electronAPI?.browser ? <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left hover:bg-surface-hover" onClick={() => { setMoreOpen(false); store.openBrowser(undefined, scope); }}>{zh ? '新建浏览器标签' : 'New browser tab'}</button> : null}
          <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left hover:bg-surface-hover" onClick={() => { setMoreOpen(false); store.openFiles(scope); }}>{zh ? '打开文件' : 'Open files'}</button>
          <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-40" disabled={scope === 'new' || Boolean(creating)} onClick={() => { setMoreOpen(false); useSideChatStore.getState().requestCreate(scope); }}>{zh ? '新建侧聊' : 'New side chat'}</button>
          <div role="separator" className="my-1.5 h-px bg-edge-subtle" />
          {treeControl ? <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left hover:bg-surface-hover" onClick={() => { setMoreOpen(false); toggleTree(); }}>{zh ? (treeShown ? '隐藏文件树' : '显示文件树') : (treeShown ? 'Hide file tree' : 'Show file tree')}</button> : null}
          {active && active.kind !== 'home' ? <button role="menuitem" disabled={active.kind === 'browser' && !browserUrl} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-40" onClick={() => {
            setMoreOpen(false);
            const text = active.kind === 'file' ? active.path ?? active.title : active.kind === 'browser' ? useEmbeddedBrowserStore.getState().tabs[active.id]?.url : active.title;
            if (text) void copyTextToClipboard(text);
          }}><Copy className="size-4 text-fg-muted" aria-hidden />{active.kind === 'file' ? (active.path ? (zh ? '复制文件路径' : 'Copy file path') : (zh ? '复制文件名称' : 'Copy file name')) : active.kind === 'browser' ? (zh ? '复制网址' : 'Copy URL') : (zh ? '复制标签名称' : 'Copy tab name')}</button> : null}
          <div role="separator" className="my-1.5 h-px bg-edge-subtle" />
          <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left hover:bg-surface-hover" onClick={() => { setMoreOpen(false); store.setWidth(0); }}>{zh ? '恢复默认宽度' : 'Reset width'}</button>
          {active ? <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-40" disabled={Boolean(closing)} onClick={() => { setMoreOpen(false); closeCurrent(); }}>{zh ? '关闭当前标签' : 'Close current tab'}</button> : null}
          <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left hover:bg-surface-hover" onClick={() => { setMoreOpen(false); store.setOpen(false, scope); }}>{zh ? '收起工作区' : 'Collapse workspace'}</button>
        </Popover.Content></Popover.Portal>
      </Popover.Root>
      <Popover.Root open={menu} onOpenChange={setMenu}>
        <Popover.Trigger asChild><button className={cn(buttonClass, menu && 'bg-surface-active')} aria-label={`${zh ? '标签列表' : 'Tab list'} (${pane.tabs.length})`}><ListTree className="size-4" aria-hidden /><span className="sr-only">{pane.tabs.length}</span></button></Popover.Trigger>
        <Popover.Portal><Popover.Content align="start" sideOffset={8} role="menu" onKeyDown={navigateMenu} aria-label={zh ? '打开的标签' : 'Open tabs'} className="workspace-menu z-[125] max-h-80 w-72 overflow-y-auto rounded-xl border border-edge bg-surface-panel p-1.5 shadow-popover">
          <p className="px-3 py-2 text-xs text-fg-muted">{zh ? '打开的标签' : 'Open tabs'} · {pane.tabs.length}</p>
          {pane.tabs.map((tab) => <button role="menuitem" key={tab.id} className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-hover', pane.activeId === tab.id && 'bg-surface-active')} onClick={() => { select(tab.id); setMenu(false); }}><span className="min-w-0 flex-1 truncate">{tabTitle(tab)}</span>{pane.activeId === tab.id ? <span className="text-xs text-fg-muted">{zh ? '当前' : 'Current'}</span> : null}</button>)}
          {!pane.tabs.length ? <p className="px-3 py-2 text-sm text-fg-muted">{zh ? '尚未打开标签' : 'No open tabs'}</p> : null}
        </Popover.Content></Popover.Portal>
      </Popover.Root>

      <span className="mx-1 h-6 w-px shrink-0 bg-edge-subtle" aria-hidden />
      <SlidingTabList ref={tabListRef} role="tablist" aria-label={zh ? '工作区标签' : 'Workspace tabs'} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onKeyDown={(event) => {
          const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
          const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); tabs[next]?.focus(); }
        }} indicatorClassName="rounded-md border border-edge bg-surface-panel">
        {!pane.tabs.length ? <span className="truncate px-2 text-sm font-medium">{zh ? '项目文件' : 'Project files'}</span> : null}
        {pane.tabs.map((tab) => {
          const side = tab.kind === 'sidechat' ? sideTabs.find((t) => t.id === tab.sideChatId) : undefined;
          const title = tabTitle(tab);
          const stateLabel = side?.waiting ? (zh ? '待处理' : 'Needs attention') : side?.disconnected ? (zh ? '连接中断' : 'Disconnected') : side?.ended ? (zh ? '已结束' : 'Ended') : side?.runId ? (zh ? '运行中' : 'Running') : side?.unread ? (zh ? '未读' : 'Unread') : fileStatus[tab.id] ? (zh ? '未保存' : 'Unsaved') : '';
          return <div key={tab.id} data-sliding-active={tab.id === pane.activeId} className={cn('group flex h-9 shrink-0 items-center rounded-md border transition-colors', tab.id === pane.activeId ? 'border-edge bg-surface-panel text-fg' : 'border-transparent text-fg-muted hover:bg-surface-hover')}>
            <button role="tab" id={`workspace-tab-${tab.id}`} aria-controls="workspace-content" aria-selected={tab.id === pane.activeId} tabIndex={tab.id === pane.activeId ? 0 : -1}
              title={tab.kind === 'file' ? tab.path || title : title} className="flex max-w-56 items-center gap-1.5 rounded-md px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => select(tab.id)} onDoubleClick={() => { if (tab.kind === 'file') store.keepFileOpen(tab.id); }}>
              {tab.kind === 'browser' ? <Globe className="size-4 shrink-0" aria-hidden /> : tab.kind === 'sidechat' ? <MessageSquare className="size-4 shrink-0" aria-hidden /> : tab.kind === 'files' ? <FolderOpen className="size-4 shrink-0" aria-hidden /> : <FileText className="size-4 shrink-0" aria-hidden />}
              <span className={cn("truncate", tab.kind === 'file' && tab.preview && "italic")}>{title}</span>{stateLabel ? <span className="shrink-0 text-xs text-fg-muted">{stateLabel}</span> : null}
            </button>
            <button className={cn(buttonClass, 'size-7')} tabIndex={tab.id === pane.activeId ? 0 : -1} aria-label={`${zh ? '关闭' : 'Close'} ${title}`} disabled={closing === tab.id} onClick={() => {
              if (tab.kind === 'file') void closeFile(tab.id);
              else if (tab.kind === 'browser') void closeBrowser(tab.id);
              else if (tab.kind !== 'sidechat') store.remove(tab.id, scope);
              else window.dispatchEvent(new CustomEvent('workspace-close-sidechat', { detail: tab.sideChatId }));
            }}><X className="size-3.5" aria-hidden /></button>
          </div>;
        })}
      </SlidingTabList>
      <button className={buttonClass} aria-label={zh ? '新建标签' : 'New tab'} title={zh ? '新建标签' : 'New tab'} onClick={() => store.openTools(scope)}><Plus className="size-5" aria-hidden /></button>

      <button className={buttonClass} aria-label={expanded ? (zh ? '还原工作区' : 'Restore workspace') : (zh ? '放大工作区' : 'Expand workspace')} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}</button>
      <button className={buttonClass} title={zh ? `收起工作区 · ${pane.tabs.length} 个标签` : `Collapse workspace · ${pane.tabs.length} tabs`} aria-label={single ? (zh ? '返回聊天' : 'Back to chat') : (zh ? '收起工作区' : 'Collapse workspace')} onClick={() => store.setOpen(false, scope)}><PanelRight className="size-5" aria-hidden /></button>
    </div>
    {notice ? <div role="alert" className="shrink-0 border-b border-edge px-3 py-2 text-sm text-fg-muted">{notice} <button className="text-accent" onClick={() => useSideChatStore.getState().requestCreate(scope)}>{zh ? '重试新建侧聊' : 'Retry new side chat'}</button></div> : null}
    {browserError ? <div role="alert" className="shrink-0 border-b border-edge px-3 py-2 text-sm text-fg-muted">{browserError} <button className="text-accent" onClick={() => setBrowserError('')}>{zh ? '关闭提示' : 'Dismiss'}</button></div> : null}
    {creating ? <div role="status" className="h-1 shrink-0 animate-pulse bg-surface-active" aria-label={zh ? '正在创建侧聊' : 'Creating side chat'} /> : null}
    {saveFailed ? <div role="alert" className="shrink-0 border-b border-edge p-3 text-sm">
      <p>{zh ? '文件未保存，可能已被外部修改。编辑内容已保留。' : 'File could not be saved; it may have changed externally. Your edits are retained.'}</p>
      <button className="mr-3 text-accent" onClick={() => void closeFile(saveFailed)}>{zh ? '重试保存并关闭' : 'Retry save and close'}</button>
      <button className="mr-3" onClick={() => { setSaveFailed(null); setDiscardRequested(false); }}>{zh ? '继续编辑' : 'Keep editing'}</button>
      <button className="text-red-600" onClick={() => setDiscardRequested(true)}>{zh ? '放弃修改' : 'Discard edits'}</button>
      {discardRequested ? <div role="alertdialog" aria-label={zh ? '确认放弃修改' : 'Confirm discard edits'} className="mt-3 rounded-lg border border-edge bg-surface-base p-3">
        <p>{zh ? '放弃此文件未保存的修改？' : 'Discard unsaved edits to this file?'}</p>
        <div className="mt-2 flex gap-3"><button className="text-accent" onClick={() => setDiscardRequested(false)}>{zh ? '保留草稿' : 'Keep draft'}</button><button onClick={() => void closeFile(saveFailed, true)}>{zh ? '确认放弃' : 'Confirm discard'}</button></div>
      </div> : null}
    </div> : null}
    <WorkspaceTreeControlContext.Provider value={treeControl ? { button: treeControl, label: zh ? (treeShown ? '隐藏文件树' : '显示文件树') : (treeShown ? 'Hide file tree' : 'Show file tree'), active: treeShown, onToggle: toggleTree } : null}>
    <div id="workspace-content" role="tabpanel" aria-labelledby={active ? `workspace-tab-${active.id}` : undefined} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className={cn('min-h-0 min-w-0 flex-1 flex-col overflow-hidden', !treeHome ? 'flex' : 'hidden')}>
        {active?.kind === 'home' ? <WorkspaceStartPage tabs={pane.tabs} canCreateSideChat={scope !== 'new'} creating={Boolean(creating)}
          onBrowser={window.electronAPI?.browser ? () => store.openBrowser(undefined, scope) : undefined}
          onFiles={() => store.openFiles(scope)} onSideChat={() => useSideChatStore.getState().requestCreate(scope)} onActivate={select}
          onTerminal={window.electronAPI?.terminal ? () => scope !== 'new' ? useTerminalPanelStore.getState().open(scope) : window.dispatchEvent(new Event('workspace-open-terminal')) : undefined} /> : null}
        {Object.entries(panes).flatMap(([owner, p]) => p.tabs.filter(t => t.kind === 'browser').map(tab => <BrowserTabView key={tab.id} tab={tab} scope={owner} active={visible && owner === scope && active?.id === tab.id} />))}
        <WorkspaceFileTargetsContext.Provider value={[
          { id: scope, label: zh ? '引用到主聊天' : 'Reference in main chat' },
          ...(file?.returnTo?.startsWith('side:') ? [{ id: file.returnTo.slice(5), label: zh ? '引用到来源侧聊' : 'Reference in source side chat' }] : []),
        ]}>
        {allFiles.map(({ owner, tab }) => {
          const isActive = present && owner === scope && active?.id === tab.id;
          if (tab.attachment) return isActive ? <AttachmentPreviewDialog key={tab.id} tabId={tab.id} embedded open attachment={tab.attachment} images={tab.images} onAttachmentChange={(attachment) => store.openFile({ attachment, images: tab.images, conversationId: tab.conversationId }, owner)} authToken={token} conversationId={tab.conversationId} onClose={() => void closeFile(tab.id)} /> : null;
          const textual = ['code', 'text', 'markdown', 'html'].includes(detectPreviewFileType(tab.title));
          if (!isActive && (!textual || (!retainedFiles.has(tab.id) && !fileStatus[tab.id]))) return null;
          return <WorkspaceFilePreviewPanel key={tab.id} tabId={tab.id} active={isActive} filePath={tab.path ?? null} projectId={tab.projectId} conversationId={tab.conversationId} agentId={tab.agentId} targetLine={tab.line} resultRevision={tab.resultRevision} onClose={() => void closeFile(tab.id)} />;
        })}
        </WorkspaceFileTargetsContext.Provider>
        {sideParents.map((parent) => <WorkspaceOwnerContext.Provider key={parent} value={parent}><SideChatColumn parentConversationId={parent} embedded visible={present && scope === parent && (active?.kind === 'sidechat' || (!active && Boolean(pending?.parentConversationId === parent || creating)))} /></WorkspaceOwnerContext.Provider>)}
      </div>
      {treeVisible && !treeHome && !treeOverlay ? <div role="separator" aria-orientation="vertical" tabIndex={0} aria-label={zh ? '调整文件树宽度' : 'Resize file tree'} aria-valuemin={200} aria-valuemax={320} aria-valuenow={treeWidth}
        className="z-10 w-2 shrink-0 cursor-col-resize touch-none border-l border-edge hover:bg-surface-hover focus-visible:bg-accent/30" onPointerDown={(event) => drag(event, true)}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); store.setTreeWidth(treeWidth + (e.key === 'ArrowLeft' ? 20 : -20)); } }} /> : null}
      {treeOverlay ? <button data-browser-occluder style={{ top: treeOverlayInset }} className="absolute inset-0 z-20 bg-scrim" aria-label={zh ? '关闭文件树' : 'Close file tree'} onClick={() => setTreeOverlay(false)} /> : null}
      <div data-workspace-tree className={cn('min-h-0 min-w-0 flex-col overflow-hidden', treeShown ? 'flex' : 'hidden', treeHome && 'flex-1', treeOverlay && 'absolute inset-y-0 right-0 z-30 border-l border-edge bg-surface-panel')} style={!treeHome ? { width: treeWidth, ...(treeOverlay ? { top: treeOverlayInset } : {}) } : undefined}>
        {Object.entries(trees).map(([key, root]) => <div key={key} className={cn('h-full min-h-0 flex-col', key === treeKey ? 'flex' : 'hidden')}><WorkspaceColumn embedded scope={root} onCloseTree={() => treeOverlay ? setTreeOverlay(false) : !treeHome ? active?.kind === 'browser' ? setBrowserTreeOpen(false) : store.setTreeOpen(active?.kind === 'sidechat' ? 'sidechat' : 'file', false) : store.setOpen(false, scope)} /></div>)}
      </div>
    </div>
    </WorkspaceTreeControlContext.Provider>
  </aside>;
}
