import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import { AttachmentRenderer } from '@/features/chat/attachments/attachment-renderer';
import { ProductDeliveryCard } from '@/features/chat/product-delivery/product-delivery-card';
import { SearchSourceList } from '@/features/chat/tool-results/search-source-list';

import type { AssistantTurnViewModel } from './assistant-turn-view-model';
import { TurnOutcomeResult } from './turn-outcome-result';

export function AssistantTurnTasks({
  view,
  authToken,
  sessionKey,
  projectId,
  sourcesLabel,
  compactProductDelivery = false,
}: {
  view: AssistantTurnViewModel;
  authToken?: string;
  sessionKey?: string | null;
  projectId?: string | null;
  sourcesLabel: string;
  compactProductDelivery?: boolean;
}) {
  return (
    <>
      {view.delivery ? (
        <ProductDeliveryCard delivery={view.delivery} compact={compactProductDelivery} />
      ) : null}

      {view.outcome ? (
        <TurnOutcomeResult
          outcome={view.outcome}
          authToken={authToken}
          sessionKey={sessionKey}
          projectId={projectId}
        />
      ) : null}

      {view.sources.length > 0 ? (
        <section
          className="rounded-lg border border-edge-subtle/60 bg-surface-elevated/10 px-3 py-2.5"
          aria-label={sourcesLabel}
        >
          <SearchSourceList sources={view.sources} className="" />
        </section>
      ) : null}
    </>
  );
}

export function AssistantAttachmentList({
  attachments,
  authToken,
  sessionKey,
  projectId,
}: {
  attachments?: MessageAttachment[];
  authToken?: string;
  sessionKey?: string | null;
  projectId?: string | null;
}) {
  if (!attachments?.length) return null;
  return (
    <AttachmentRenderer
      attachments={attachments}
      authToken={authToken}
      sessionKey={sessionKey}
      projectId={projectId}
      layout="assistant"
    />
  );
}
