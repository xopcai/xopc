import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import { AttachmentRenderer } from '@/features/chat/attachments/attachment-renderer';
import { SearchSourceList } from '@/features/chat/tool-results/search-source-list';
import { ToolResultFileLinks } from '@/features/chat/tool-results/tool-result-file-links';

import type { AssistantTurnViewModel } from './assistant-turn-view-model';

export function AssistantTurnOutcomes({
  view,
  authToken,
  sessionKey,
  deliverablesLabel,
  sourcesLabel,
}: {
  view: AssistantTurnViewModel;
  authToken?: string;
  sessionKey?: string | null;
  deliverablesLabel: string;
  sourcesLabel: string;
}) {
  const { workspacePaths, imageAttachments } = view.deliverables;
  const showDeliverables = workspacePaths.length > 0 || imageAttachments.length > 0;

  return (
    <>
      {showDeliverables ? (
        <section
          className="rounded-lg border border-edge-subtle/60 bg-surface-elevated/20 px-3 py-2.5"
          aria-label={deliverablesLabel}
        >
          <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
            {deliverablesLabel}
          </h3>
          <div className="flex min-w-0 flex-col gap-2">
            {workspacePaths.length > 0 ? (
              <ToolResultFileLinks paths={workspacePaths} sessionKey={sessionKey} />
            ) : null}
            {imageAttachments.length > 0 ? (
              <AttachmentRenderer
                attachments={imageAttachments}
                authToken={authToken}
                sessionKey={sessionKey}
                layout="assistant"
              />
            ) : null}
          </div>
        </section>
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
}: {
  attachments?: MessageAttachment[];
  authToken?: string;
  sessionKey?: string | null;
}) {
  if (!attachments?.length) return null;
  return (
    <AttachmentRenderer
      attachments={attachments}
      authToken={authToken}
      sessionKey={sessionKey}
      layout="assistant"
    />
  );
}
