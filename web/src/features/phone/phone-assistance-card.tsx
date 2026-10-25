import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useLocaleStore } from '@/stores/locale-store';
import { controlPhone, phoneErrorMessage, useConversationPhone, type PhoneLiveState } from './phone-live-api';
import { usePhoneWorkspaceStore } from './phone-workspace-store';

export function PhoneAssistanceActions({ conversationId, state, onChange }: {
  conversationId: string; state: PhoneLiveState; onChange: (state: PhoneLiveState) => void;
}) {
  const zh = useLocaleStore(s => s.language) === 'zh';
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const otherHuman = state.report.controlOwner === 'human' && !state.ownControl;
  async function act(op: 'takeover' | 'handback') {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const next = await controlPhone(conversationId, state, op);
      onChange(next);
      if (op === 'takeover') usePhoneWorkspaceStore.getState().show(next.report.sessionId, true, conversationId);
    } catch (failure) { setError(phoneErrorMessage(failure, zh)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      {!state.ownControl && <Button variant="primary" disabled={busy || otherHuman} onClick={() => void act('takeover')}>{zh ? '接管手机' : 'Take over phone'}</Button>}
      <Button variant={state.ownControl ? 'primary' : 'secondary'} disabled={busy || otherHuman} onClick={() => void act('handback')}>{zh ? '已完成，继续任务' : 'Done, continue task'}</Button>
    </div>
    {otherHuman && <p className="text-xs text-fg-muted">{zh ? '另一窗口正在操作手机' : 'Another window controls the phone'}</p>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </div>;
}

export function PhoneAssistanceCard({ conversationId }: { conversationId: string }) {
  const { data, mutate } = useConversationPhone(conversationId);
  const zh = useLocaleStore(s => s.language) === 'zh';
  if (!data?.report.assistanceId || !['needs_user', 'paused'].includes(data.report.status)) return null;
  return <section role="status" aria-live="polite" className="space-y-2 rounded-xl border border-edge bg-surface-panel p-3 text-sm">
    <p className="font-medium">{zh ? '需要你在手机上操作' : 'Your help is needed on the phone'}</p>
    <p className="whitespace-pre-wrap break-words text-fg-muted">{data.report.message || (zh ? '请完成手机上的操作，再继续原任务。' : 'Complete the requested phone action, then continue the task.')}</p>
    <PhoneAssistanceActions conversationId={conversationId} state={data} onChange={next => { void mutate(next, false); window.dispatchEvent(new Event('phone-connections-changed')); }} />
  </section>;
}
