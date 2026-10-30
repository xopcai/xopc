import { Monitor } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useLocaleStore } from '@/stores/locale-store';
import { useComputerPreview } from './use-computer-preview';

export function ComputerChatButton({ conversationId }: { conversationId: string }) {
  const { state } = useComputerPreview(conversationId, false);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const zh = useLocaleStore(s => s.language === 'zh');
  if (!state || state.conversationId !== conversationId || state.status === 'ended') return null;
  const focus = async () => {
    const api = window.electronAPI?.computer;
    if (!api?.focusTarget || opening) return;
    setOpening(true); setFailed(false);
    try { await api.focusTarget(conversationId, state.previewId); }
    catch { setFailed(true); }
    finally { setOpening(false); }
  };
  return <Button variant="ghost" className="min-h-10 gap-1.5 px-2" disabled={opening || !window.electronAPI?.computer?.focusTarget}
    title={failed ? (zh ? '暂时无法切换应用，请稍后重试' : 'Could not switch to the app. Try again shortly.') : (zh ? '切换到正在操作的应用' : 'Switch to the active app')}
    aria-label={zh ? '切换到正在操作的应用' : 'Switch to the active app'} onClick={() => { void focus(); }}>
    <Monitor className="size-4" aria-hidden /><span className="text-xs">{failed ? (zh ? '重试切换' : 'Retry switch') : (zh ? '电脑' : 'Computer')}</span>
  </Button>;
}
