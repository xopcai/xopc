import { Smartphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLocaleStore } from '@/stores/locale-store';
import { useRightWorkspaceStore } from '@/stores/right-workspace-store';
import { phoneAttentionKey, usePhoneAttention } from './phone-attention';
import { phoneEnded, useConversationPhone } from './phone-live-api';

export function PhoneChatButton({ conversationId }: { conversationId: string }) {
  const { data } = useConversationPhone(conversationId);
  const zh = useLocaleStore(s => s.language) === 'zh';
  const seen = usePhoneAttention(s => s.seen);
  const key = data ? phoneAttentionKey(conversationId, data.report) : null;
  const attention = Boolean(key && !seen.includes(key));
  if (!data || phoneEnded(data.report.status)) return null;
  return <Button variant="ghost" className="min-h-10 gap-1.5 px-2" title={attention ? (zh ? '手机需要你操作' : 'Your help is needed on the phone') : (zh ? '查看手机' : 'View phone')} aria-label={attention ? (zh ? '手机需要你操作' : 'Your help is needed on the phone') : (zh ? '查看手机' : 'View phone')} onClick={() => useRightWorkspaceStore.getState().openPhone(data.report.deviceId ?? data.report.sessionId, data.report.deviceName, conversationId, true)}>
    <span className="relative"><Smartphone className="size-4" aria-hidden />{attention && <span aria-hidden className="absolute -right-1 -top-1 size-1.5 rounded-full bg-accent" />}</span><span className="text-xs">{zh ? '手机' : 'Phone'}</span>
  </Button>;
}
