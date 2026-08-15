import { useEffect, useState } from 'react';

import { useGatewayStore } from '@/stores/gateway-store';

import { DiscussionCaptureDialog } from './discussion-capture-dialog';
import { OPEN_DISCUSSION_CAPTURE_EVENT } from './discussion-events';

export function GlobalDiscussionCaptureHost() {
  const token = useGatewayStore((state) => state.token);
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | undefined>();

  useEffect(() => {
    const handler = (event: Event) => {
      if (!token) return;
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      setProjectId(detail?.projectId);
      setOpen(true);
    };
    window.addEventListener(OPEN_DISCUSSION_CAPTURE_EVENT, handler);
    return () => window.removeEventListener(OPEN_DISCUSSION_CAPTURE_EVENT, handler);
  }, [token]);

  return open ? <DiscussionCaptureDialog initialProjectId={projectId} onClose={() => setOpen(false)} /> : null;
}

