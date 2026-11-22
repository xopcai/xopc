import { Globe } from 'lucide-react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { isSessionSliceLive, useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useRightWorkspaceStore } from '@/stores/right-workspace-store';

type PreviewAvailability = {
  available: boolean;
  mode?: 'extension' | 'managed';
  status?: 'running' | 'needs_user' | 'human' | 'ended';
};

export function BrowserPreviewButton({ conversationId }: { conversationId: string }) {
  const zh = useLocaleStore(state => state.language === 'zh');
  const identity = useGatewayStore(state => state.conversationId);
  const live = useChatSessionStore(state => isSessionSliceLive(state.sessions[conversationId]));
  const { data } = useSWR(
    conversationId ? [`/api/browser/preview/${encodeURIComponent(conversationId)}`, identity] : null,
    ([path]) => fetchJson<PreviewAvailability>(apiUrl(path)),
    { refreshInterval: live ? 1800 : 4000, shouldRetryOnError: false },
  );
  const managed = data?.mode === 'managed';
  if (!data?.available || (!managed && (!live || typeof RTCPeerConnection === 'undefined'))) return null;
  const needsUser = managed && data.status === 'needs_user';
  const label = needsUser
    ? (zh ? '接管浏览器' : 'Take over browser')
    : (zh ? '查看浏览器' : 'View browser');
  return <Button variant={needsUser ? 'primary' : 'ghost'} className="size-8 shrink-0 gap-1.5 rounded-lg p-0 xl:w-auto xl:px-2"
    aria-label={label} title={label} onClick={() => useRightWorkspaceStore.getState().openBrowserPreview(conversationId, data.mode)}>
    <Globe className="size-4 shrink-0" aria-hidden />
    <span className="hidden whitespace-nowrap text-xs xl:inline">{label}</span>
  </Button>;
}
