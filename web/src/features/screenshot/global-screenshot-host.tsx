import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { loadAttachment } from '@/features/chat/attachments/attachment-load';
import { deliverExternalIntake } from '@/features/chat/composer/external-intake-receiver';
import { dispatchFillChatComposer } from '@/features/chat/composer/fill-composer-dispatch';
import { SessionManager } from '@/features/chat/session/session-manager';
import { useChatRouteConversationId } from '@/features/chat/use-chat-route-conversation-id';
import { noteDetailHref } from '@/features/notes/note-detail-route';
import { quickCaptureImage, updateNote } from '@/features/notes/notes-api';
import { useGatewayStore } from '@/stores/gateway-store';

type ScreenshotPayload = {
  id: string;
  createdAt: number;
  pngBase64: string;
  fileName: string;
  width: number;
  height: number;
  prompt?: string;
  targetMode: 'chat' | 'note';
};

function pngBase64ToFile(pngBase64: string, fileName: string): File {
  const binary = atob(pngBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], fileName || 'screenshot.png', { type: 'image/png' });
}

export function GlobalScreenshotHost() {
  const api = window.electronAPI?.screenshot;
  const principal = useGatewayStore((s) => s.conversationId);
  const location = useLocation();
  const navigate = useNavigate();
  const currentChatId = useChatRouteConversationId(location.pathname);
  const currentChatIdRef = useRef(currentChatId);
  currentChatIdRef.current = currentChatId;
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;
  const seenIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!api || !principal) return;
    let active = true;

    const handleDelivery = async (payload: ScreenshotPayload) => {
      if (!active || seenIdsRef.current.has(payload.id)) return;
      seenIdsRef.current.add(payload.id);
      void api.ackDelivery?.(payload.id).catch(() => undefined);
      try {
        const file = pngBase64ToFile(payload.pngBase64, payload.fileName);

        if (payload.targetMode === 'note') {
          let note = await quickCaptureImage(file, 'web');
          if (payload.prompt?.trim()) {
            note = await updateNote(note.id, {
              markdown: `${note.markdown}\n\n${payload.prompt.trim()}`,
            });
          }
          if (active) {
            navigate(noteDetailHref(note.id, pathnameRef.current));
          }
          return;
        }

        const attachment = await loadAttachment(file);
        let targetConversationId = currentChatIdRef.current;
        if (!targetConversationId) {
          const agents = await fetchChatAgents();
          const created = await new SessionManager().createSession({ agentId: agents.defaultId });
          targetConversationId = created.key;
        }

        if (!active) return;
        navigate(`/chat/${encodeURIComponent(targetConversationId)}`);

        const scope = JSON.stringify([principal, targetConversationId]);
        await deliverExternalIntake(scope, `screenshot:${payload.id}`, [
          { ...attachment, id: `screenshot:${payload.id}` },
        ]);

        if (active && payload.prompt?.trim()) {
          setTimeout(() => {
            dispatchFillChatComposer(payload.prompt!.trim());
          }, 40);
        }
      } catch (error) {
        console.warn('[GlobalScreenshotHost] Failed to deliver screenshot', error);
      }
    };

    void api
      .takePendingDeliveries()
      .then((items) => {
        for (const item of items) {
          void handleDelivery(item);
        }
      })
      .catch(() => undefined);

    const unsubscribe = api.onDeliverToChat((payload) => {
      void handleDelivery(payload);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [api, navigate, principal]);

  return null;
}
