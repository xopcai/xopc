import * as Dialog from '@radix-ui/react-dialog';
import { FileText, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import type { ExternalIntakeBatch } from '../../../../electron/external-intake';
import { Skeleton } from '@/components/ui/skeleton';
import { listSessions, getSessionDetail } from '@/features/sessions/session-api';
import type { SessionMetadata } from '@/features/sessions/session.types';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useChatRouteConversationId } from './use-chat-route-conversation-id';
import { fetchChatAgents } from './agent-selection/chat-agents-api';
import { loadAttachment } from './attachments/attachment-load';
import { formatFileSize } from './attachments/attachment-utils';
import { deliverExternalIntake } from './composer/external-intake-receiver';
import { SessionManager } from './session/session-manager';
import { readLocalSessionDraft } from './session/local-session-drafts';

export function ExternalIntakeHost() {
  const api = window.electronAPI?.intake;
  const token = useGatewayStore(state => state.conversationId);
  const baseUrl = useGatewayStore(state => state.baseUrl);
  const zh = useLocaleStore(state => state.language) === 'zh';
  const [batches, setBatches] = useState<ExternalIntakeBatch[]>([]);
  useEffect(() => {
    if (!api) return;
    let active = true;
    const refresh = () => { void api.list().then(items => { if (active) setBatches(items); }).catch(() => {}); };
    refresh();
    const unsubscribe = api.onChanged(refresh);
    return () => { active = false; unsubscribe(); };
  }, [api]);
  if (!api || !token || !batches[0]) return null;
  return <IntakeDialog key={`${batches[0].id}:${baseUrl}:${token}`} batch={batches[0]} count={batches.length} zh={zh}
    onDone={async () => setBatches(await api.list())} />;
}

function IntakeDialog({ batch, count, zh, onDone }: { batch: ExternalIntakeBatch; count: number; zh: boolean; onDone(): Promise<void> }) {
  const api = window.electronAPI!.intake!;
  const navigate = useNavigate();
  const currentId = useChatRouteConversationId(useLocation().pathname);
  const [target, setTarget] = useState(batch.target?.conversationId ?? 'new');
  const [scope, setScope] = useState('');
  const [search, setSearch] = useState('');
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [current, setCurrent] = useState<SessionMetadata>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [excluded, setExcluded] = useState<string[]>([]);
  const identity = useRef(useGatewayStore.getState());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    void crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([identity.current.baseUrl, identity.current.conversationId])))
      .then(buffer => { if (alive.current) setScope(Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('')); });
    if (currentId) void getSessionDetail(currentId).then(setCurrent).catch(() => {});
  }, [currentId]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void listSessions({ search, limit: 30, sortBy: 'updatedAt', sortOrder: 'desc' })
        .then(result => { if (active) setSessions(result.items); })
        .catch(reason => { if (active) setError(String(reason)); })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [search]);
  const assertIdentity = () => {
    const now = useGatewayStore.getState();
    if (!alive.current || now.baseUrl !== identity.current.baseUrl || now.conversationId !== identity.current.conversationId) throw new Error(zh ? '连接已更改，请重新选择对话' : 'Connection changed. Choose a conversation again.');
  };
  const mismatch = Boolean(batch.target && scope && batch.target.scope !== scope);
  const items = batch.items.filter(item => !item.error && !excluded.includes(item.id));
  const commit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      assertIdentity();
      const attachments = [];
      for (const item of items) {
        const encoded = await api.read(batch.id, item.id);
        assertIdentity();
        const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
        const attachment = await loadAttachment(new File([bytes], item.name));
        attachments.push({ ...attachment, id: `intake:${batch.id}:${item.id}` });
      }
      assertIdentity();
      let id = target;
      if (id === 'new') {
        const agents = await fetchChatAgents();
        assertIdentity();
        id = (await new SessionManager().createSession({ agentId: agents.defaultId })).key;
      } else if (!await readLocalSessionDraft(id)) {
        const session = await getSessionDetail(id);
        if (session.status === 'archived') throw new Error(zh ? '此对话无法继续输入，请选择其他对话' : 'This conversation is not active. Choose another.');
      }
      assertIdentity();
      await api.target(batch.id, scope, id);
      setTarget(id);
      navigate(`/chat/${encodeURIComponent(id)}`);
      await deliverExternalIntake(JSON.stringify([identity.current.conversationId, id]), batch.id, attachments);
      assertIdentity();
      await api.remove(batch.id);
      await onDone();
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (alive.current) setBusy(false); }
  };
  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try { await api.remove(batch.id); await onDone(); }
    catch (reason) { setError(String(reason)); setBusy(false); }
  };
  const option = (id: string, label: string, detail?: string) => <label key={id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-edge p-3">
    <input type="radio" name="intake-target" checked={target === id} disabled={busy || Boolean(batch.target)} onChange={() => setTarget(id)} />
    <span className="min-w-0 flex-1 truncate text-sm">{label}{detail && <span className="block truncate text-xs text-fg-muted">{detail}</span>}</span>
  </label>;
  return <Dialog.Root open onOpenChange={open => { if (!open) void cancel(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/40" />
    <Dialog.Content onPointerDownOutside={event => event.preventDefault()} className="fixed left-1/2 top-1/2 z-[101] flex h-[min(640px,calc(100dvh-32px))] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel text-fg shadow-elevated">
      <div className="border-b border-edge p-4"><Dialog.Title className="font-semibold">{zh ? '添加到对话' : 'Add to conversation'}</Dialog.Title>
        <Dialog.Description className="mt-1 text-xs text-fg-muted">{zh ? `共 ${batch.items.length} 个文件${count > 1 ? `，另有 ${count - 1} 批待处理` : ''}` : `${batch.items.length} files · ${count} pending batches`}</Dialog.Description></div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {batch.items.map(item => <div key={item.id} className="flex items-center gap-2 rounded-lg border border-edge p-3 text-sm"><FileText size={18} /><span className="min-w-0 flex-1 truncate">{item.name}<span className="block text-xs text-fg-muted">{item.error ?? formatFileSize(item.size)}</span></span>
          {!item.error && <button type="button" disabled={busy} aria-label={zh ? '移除附件' : 'Remove attachment'} onClick={() => setExcluded(previous => previous.includes(item.id) ? previous.filter(id => id !== item.id) : [...previous, item.id])} className="min-h-11 min-w-11 text-xs">{excluded.includes(item.id) ? (zh ? '恢复' : 'Restore') : <X size={16} />}</button>}</div>)}
        {batch.target ? <>{option(batch.target.conversationId, zh ? '继续加入已选择的对话' : 'Continue to selected conversation')}
          {!mismatch && <button type="button" className="min-h-11 text-sm text-accent" disabled={busy} onClick={() => {
            setBusy(true);
            void api.release(batch.id, scope).then(async () => { setTarget('new'); setError(''); await onDone(); })
              .catch(reason => setError(String(reason))).finally(() => setBusy(false));
          }}>{zh ? '选择其他对话' : 'Choose another conversation'}</button>}
        </> : <>
          {option('new', zh ? '新对话' : 'New conversation', zh ? '默认推荐' : 'Recommended')}
          {currentId && option(currentId, `${zh ? '当前对话' : 'Current conversation'} · ${current?.name || currentId}`, current?.agentId)}
          <input className="h-11 w-full rounded-lg border border-edge bg-surface-panel px-3 text-sm" aria-label={zh ? '搜索已有对话' : 'Search conversations'} placeholder={zh ? '搜索已有对话' : 'Search conversations'} value={search} onChange={event => setSearch(event.target.value)} disabled={busy} />
          {loading ? <><Skeleton className="h-14" /><Skeleton className="h-14" /></> : sessions.filter(session => session.key !== currentId && session.status !== 'archived').map(session => option(session.key, session.name || session.key, `${session.agentId} · ${session.projectId ?? ''} · ${new Date(session.updatedAt).toLocaleDateString()}`))}
        </>}
        {mismatch && <p role="alert" className="text-sm text-fg-muted">{zh ? '此批文件已绑定其他账号或网关，请切换回原连接继续。' : 'This batch belongs to another connection. Switch back to continue.'}</p>}
        {error && <p role="alert" className="text-sm text-fg-muted">{error}</p>}
      </div>
      <div className="border-t border-edge p-4"><p className="mb-3 text-xs text-fg-muted">{zh ? '保留原草稿，点击发送后才交给 AI' : 'Keeps your draft. AI starts only when you send.'}</p><div className="flex justify-end gap-3">
        <button className="min-h-11 rounded-lg border border-edge px-4 text-sm" disabled={busy} onClick={() => void cancel()}>{zh ? '取消' : 'Cancel'}</button>
        <button className="min-h-11 rounded-lg bg-accent px-4 text-sm text-white disabled:opacity-50" disabled={busy || !scope || mismatch || !items.length} onClick={() => void commit()}>{busy ? (zh ? '正在加入…' : 'Adding…') : target === 'new' ? (zh ? '加入新对话' : 'Add to new conversation') : (zh ? '加入输入框' : 'Add to input')}</button>
      </div></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
