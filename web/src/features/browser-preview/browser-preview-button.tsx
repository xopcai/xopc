import { Globe } from 'lucide-react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { isSessionSliceLive, useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useRightWorkspaceStore } from '@/stores/right-workspace-store';

export function BrowserPreviewButton({ conversationId }: { conversationId: string }) {
  const zh = useLocaleStore(state => state.language === 'zh');
  const identity = useGatewayStore(state => state.conversationId);
  const live = useChatSessionStore(state => isSessionSliceLive(state.sessions[conversationId]));
  const { data } = useSWR(live ? [`/api/browser/preview/${encodeURIComponent(conversationId)}`, identity] : null,
    ([path]) => fetchJson<{ available: boolean }>(apiUrl(path)), { refreshInterval: 1800, shouldRetryOnError: false });
  if (!live || !data?.available || typeof RTCPeerConnection === 'undefined') return null;
  const label = zh ? '查看浏览器' : 'View browser';
  return <Button variant="ghost" className="size-8 shrink-0 gap-1.5 rounded-lg p-0 xl:w-auto xl:px-2"
    aria-label={label} title={label} onClick={() => useRightWorkspaceStore.getState().openBrowserPreview(conversationId)}>
    <Globe className="size-4 shrink-0" aria-hidden />
    <span className="hidden whitespace-nowrap text-xs xl:inline">{label}</span>
  </Button>;
}
