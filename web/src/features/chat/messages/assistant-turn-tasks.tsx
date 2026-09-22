import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import { AttachmentRenderer } from '@/features/chat/attachments/attachment-renderer';
import { ProductDeliveryCard } from '@/features/chat/product-delivery/product-delivery-card';
import { SearchSourceList } from '@/features/chat/tool-results/search-source-list';

import type { AssistantTurnViewModel } from './assistant-turn-view-model';
import { TurnOutcomeResult } from './turn-outcome-result';

export function AssistantTurnTasks({
  view,
  authToken,
  conversationId,
  projectId,
  sourcesLabel,
  compactProductDelivery = false,
}: {
  view: AssistantTurnViewModel;
  authToken?: string;
  conversationId?: string | null;
  projectId?: string | null;
  sourcesLabel: string;
  compactProductDelivery?: boolean;
}) {
  return (
    <>
      {view.deliveries.map(({ key, delivery }) => (
        <ProductDeliveryCard key={key} delivery={delivery} compact={compactProductDelivery} />
      ))}

      {view.outcome ? (
        <TurnOutcomeResult
          outcome={view.outcome}
          authToken={authToken}
          conversationId={conversationId}
          projectId={projectId}
        />
      ) : null}

      {view.sources.length > 0 ? (
        <section
          className="rounded-lg bg-surface-panel/10 px-3 py-2.5"
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
  conversationId,
  workspaceConversationId,
  projectId,
}: {
  attachments?: MessageAttachment[];
  authToken?: string;
  conversationId?: string | null;
  workspaceConversationId?: string | null;
  projectId?: string | null;
}) {
  if (!attachments?.length) return null;
  return (
    <AttachmentRenderer
      attachments={attachments}
      authToken={authToken}
      conversationId={conversationId}
      workspaceConversationId={workspaceConversationId}
      projectId={projectId}
      layout="assistant"
    />
  );
}
