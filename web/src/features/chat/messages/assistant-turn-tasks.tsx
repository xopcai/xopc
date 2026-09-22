import { SearchSourceList } from '@/features/chat/tool-results/search-source-list';

import { AssistantResultTail } from './assistant-result-tail';
import type { AssistantTurnViewModel } from './assistant-turn-view-model';
import { TurnOutcomeDetails } from './turn-outcome-details';

export function AssistantTurnTasks({
  view,
  authToken,
  conversationId,
  projectId,
  sourcesLabel,
}: {
  view: AssistantTurnViewModel;
  authToken?: string;
  conversationId?: string | null;
  projectId?: string | null;
  sourcesLabel: string;
}) {
  return (
    <>
      <AssistantResultTail
        view={view}
        authToken={authToken}
        conversationId={conversationId}
        projectId={projectId}
      />

      {view.outcome ? (
        <TurnOutcomeDetails outcome={view.outcome} />
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
