import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw, X } from 'lucide-react';
import { useContext, useEffect, useRef, useState } from 'react';

import { WorkspaceTreeControlContext } from '@/features/right-workspace/workspace-context';
import { Skeleton } from '@/components/ui/skeleton';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useRightWorkspaceStore, type BrowserTab as Tab } from '@/stores/right-workspace-store';
import { resolveBrowserInput, type BrowserSearchEngine } from '../../../../electron/browser/url-policy';
import { useEmbeddedBrowserStore } from './browser-store';
import { useBrowserLayout } from './use-browser-layout';

export function BrowserTabView({ tab, scope, active }: { tab: Tab; scope: string; active: boolean }) {
  const treeControl = useContext(WorkspaceTreeControlContext);
  const zh = useLocaleStore(s => s.language) === 'zh';
  const identity = useGatewayStore(s => s.conversationId);
  const state = useEmbeddedBrowserStore(s => s.tabs[tab.id]);
  const content = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [address, setAddress] = useState(tab.initialUrl ?? '');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [engine, setEngine] = useState<BrowserSearchEngine>();
  const [chooseSearch, setChooseSearch] = useState(false);
  const api = window.electronAPI?.browser;
  useEffect(() => {
    if (!api || !identity) return;
    let cancelled = false;
    void api.ensure({ workspaceTabId: tab.id, scope, identity }).then(async result => {
      if (cancelled) {
        const exists = Object.values(useRightWorkspaceStore.getState().panes).some(p => p.tabs.some(t => t.id === tab.id));
        if (!exists) await api.close(result.id);
        return;
      }
      useEmbeddedBrowserStore.getState().update(result);
      if (!result.url && tab.initialUrl) await api.navigate(result.id, tab.initialUrl);
    }).catch(e => { if (!cancelled) setError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [api, identity, scope, tab.id, tab.initialUrl]);
  useEffect(() => { if (!editing && state?.url) setAddress(state.url); }, [editing, state?.url]);
  useBrowserLayout(content, state?.id, active && Boolean(state?.url) && !state?.error && !state?.crashed && !chooseSearch);
  useEffect(() => {
    if (!active) return;
    const keys = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l') { event.preventDefault(); input.current?.focus(); input.current?.select(); }
    };
    const focusAddress = (event: Event) => { if ((event as CustomEvent).detail === tab.id) { input.current?.focus(); input.current?.select(); } };
    window.addEventListener('browser-focus-address', focusAddress);
    window.addEventListener('keydown', keys);
    return () => { window.removeEventListener('keydown', keys); window.removeEventListener('browser-focus-address', focusAddress); };
  }, [active, tab.id]);
  async function navigate(selectedEngine = engine) {
    if (!api || !state) return;
    try {
      const url = resolveBrowserInput(address, selectedEngine);
      if (!url) { setChooseSearch(Boolean(address.trim())); return; }
      setChooseSearch(false); setError(''); setEditing(false);
      await api.navigate(state.id, url);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  function command(action: 'back' | 'forward' | 'reload' | 'stop') {
    if (!api || !state) return;
    setError('');
    void api.command(state.id, action).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }
  const control = 'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30';
  if (!active) return <div ref={content} hidden />;
  return <div className="flex min-h-0 flex-1 flex-col" data-browser-tab>
    <form data-workspace-toolbar className="flex h-14 shrink-0 items-center gap-1 border-b border-edge-subtle px-2" onSubmit={event => { event.preventDefault(); void navigate(); }}>
      <button type="button" className={control} aria-label={zh ? '网页后退' : 'Browser back'} disabled={!state?.canGoBack} onClick={() => command('back')}><ArrowLeft className="size-4" /></button>
      <button type="button" className={control} aria-label={zh ? '网页前进' : 'Browser forward'} disabled={!state?.canGoForward} onClick={() => command('forward')}><ArrowRight className="size-4" /></button>
      <button type="button" className={control} aria-label={state?.loading ? (zh ? '停止加载网页' : 'Stop loading page') : (zh ? '刷新网页' : 'Reload page')} disabled={!state?.url && !state?.loading} onClick={() => command(state?.loading ? 'stop' : 'reload')}>{state?.loading ? <X className="size-4" /> : <RotateCw className="size-4" />}</button>
      <input ref={input} aria-label={zh ? '搜索或输入网址' : 'Search or enter a URL'} autoComplete="off" spellCheck={false} value={address} onFocus={() => setEditing(true)} onBlur={() => setEditing(false)} onChange={event => setAddress(event.target.value)} placeholder={zh ? '搜索或输入网址' : 'Search or enter a URL'} className="h-9 min-w-0 flex-1 rounded-full border border-edge-subtle bg-surface-base px-3 text-sm text-fg outline-none focus:border-accent" />
      {treeControl}
      <button type="button" className={control} aria-label={zh ? '在系统浏览器打开' : 'Open in system browser'} disabled={!state?.url} onClick={() => { if (state?.url) void window.electronAPI?.shell?.openExternalUrl(state.url).catch(e => setError(e instanceof Error ? e.message : String(e))); }}><ExternalLink className="size-4" /></button>
    </form>
    {error ? <p role="alert" className="border-b border-edge px-3 py-2 text-sm text-fg-muted">{error}</p> : null}
    {state?.notice ? <p role="status" className="border-b border-edge px-3 py-2 text-xs text-fg-muted">{state.notice}</p> : null}
    {chooseSearch ? <div role="dialog" aria-label={zh ? '选择搜索引擎' : 'Choose a search engine'} className="border-b border-edge p-4 text-sm"><p>{zh ? '选择搜索引擎后才会提交这次搜索。' : 'Choose where to send this search.'}</p><div className="mt-3 flex gap-3">{(['duckduckgo', 'google', 'bing'] as const).map(value => <button key={value} type="button" className="rounded-lg border border-edge px-3 py-2 hover:bg-surface-hover" onClick={() => { setEngine(value); void navigate(value); }}>{value === 'duckduckgo' ? 'DuckDuckGo' : value === 'google' ? 'Google' : 'Bing'}</button>)}<button type="button" onClick={() => setChooseSearch(false)}>{zh ? '取消' : 'Cancel'}</button></div></div> : null}
    <div ref={content} className="relative min-h-0 flex-1 overflow-hidden bg-surface-base" data-browser-surface>
      {!state && error ? <div className="p-8 text-sm text-fg-muted">{zh ? '无法创建浏览器标签。关闭其他网页后重试。' : 'Browser tab could not be created. Close another page and try again.'}</div> : !state ? <div className="space-y-4 p-6"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-40 w-full" /></div> : state.error ? <div role="alert" className="p-8"><p className="text-sm text-fg-muted">{state.error}</p><button type="button" className="mt-4 text-accent" onClick={() => command('reload')}>{zh ? '重试' : 'Retry'}</button></div> : !state.url ? <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-fg-muted"><Globe className="size-9" /><h2 className="text-lg text-fg">{zh ? '浏览网页' : 'Browse the web'}</h2><p className="text-sm">{zh ? '输入网址开始。网页内容不会自动发送到聊天。' : 'Enter an address to begin. Pages are not automatically shared with chat.'}</p></div> : null}
    </div>
  </div>;
}

export function useBrowserEvents() {
  useEffect(() => window.electronAPI?.browser?.onEvent(event => {
    if (event.kind === 'state') {
      useEmbeddedBrowserStore.getState().update(event.state);
      useRightWorkspaceStore.getState().updateBrowserTitle(event.state.workspaceTabId, event.state.title);
    } else if (event.kind === 'focus-address') {
      window.dispatchEvent(new CustomEvent('browser-focus-address', { detail: event.workspaceTabId }));
    } else {
      const store = useRightWorkspaceStore.getState();
      const count = Object.values(store.panes).flatMap(p => p.tabs).filter(t => t.kind === 'browser').length;
      if (count < 24) store.openBrowser(event.url, event.scope, event.sourceTabId);
    }
  }), []);
}
