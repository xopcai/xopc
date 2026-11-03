import { ChevronRight, Globe } from 'lucide-react';

import { SearchSourceList } from '@/features/chat/tool-results/search-source-list';

import { AssistantCapsuleContent, assistantCapsuleClassName, assistantCapsuleDetailClassName } from './assistant-capsule';
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
        <details className="group min-w-0 max-w-full" aria-label={sourcesLabel}>
          <summary className={`${assistantCapsuleClassName} cursor-pointer list-none`}>
            <AssistantCapsuleContent icon={<Globe />} title={sourcesLabel}
              trailing={<ChevronRight className="size-3.5 shrink-0 text-fg-subtle transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />} />
          </summary>
          <div className={assistantCapsuleDetailClassName}>
            <SearchSourceList sources={view.sources} className="" />
          </div>
        </details>
      ) : null}
    </>
  );
}
