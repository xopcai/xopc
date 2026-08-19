import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import { AttachmentRenderer } from '@/features/chat/attachments/attachment-renderer';
import {
  TOOL_NAMES_WITH_MEDIA_OUTPUT,
  TOOL_NAMES_WITH_WORKSPACE_OUTPUT,
} from '@/features/chat/messages/assistant-message-artifacts';
import { SearchSourceList } from '@/features/chat/tool-results/search-source-list';
import { ToolResultFileLinks } from '@/features/chat/tool-results/tool-result-file-links';
import { Skeleton } from '@/components/ui/skeleton';

import type { AssistantTurnViewModel } from './assistant-turn-view-model';

export function AssistantTurnTasks({
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
  const { workspacePaths, mediaAttachments } = view.deliverables;
  const awaitingDeliverables =
    view.lifecycle.state === 'using_tool' &&
    Boolean(
      view.lifecycle.activeTool &&
        (TOOL_NAMES_WITH_WORKSPACE_OUTPUT.has(view.lifecycle.activeTool.name) ||
          TOOL_NAMES_WITH_MEDIA_OUTPUT.has(view.lifecycle.activeTool.name)),
    );
  const showDeliverableSkeleton =
    awaitingDeliverables && workspacePaths.length === 0 && mediaAttachments.length === 0;
  const showDeliverables =
    awaitingDeliverables || workspacePaths.length > 0 || mediaAttachments.length > 0;

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
            {showDeliverableSkeleton ? (
              <div className="flex min-h-14 items-center gap-2" aria-hidden>
                <Skeleton className="size-12 shrink-0 rounded-md" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ) : null}
            {workspacePaths.length > 0 ? (
              <ToolResultFileLinks paths={workspacePaths} sessionKey={sessionKey} />
            ) : null}
            {mediaAttachments.length > 0 ? (
              <AttachmentRenderer
                attachments={mediaAttachments}
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
