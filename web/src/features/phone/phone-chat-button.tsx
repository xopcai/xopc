import { Smartphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLocaleStore } from '@/stores/locale-store';
import { useRightWorkspaceStore } from '@/stores/right-workspace-store';
import { useConversationPhone } from './phone-live-api';

export function PhoneChatButton({ conversationId }: { conversationId: string }) {
  const { data } = useConversationPhone(conversationId);
  const zh = useLocaleStore(s => s.language) === 'zh';
  if (!data) return null;
  return <Button variant="ghost" className="min-h-10 gap-1.5 px-2" aria-label={zh ? '查看手机' : 'View phone'} onClick={() => useRightWorkspaceStore.getState().openPhone(data.report.deviceId ?? data.report.sessionId, data.report.deviceName, conversationId, true)}>
    <Smartphone className="size-4" aria-hidden /><span className="text-xs">{zh ? '手机' : 'Phone'}</span>
  </Button>;
}
