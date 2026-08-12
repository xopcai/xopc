import { publishInstructionFeedback } from '../scenarios/repository.js';

import { getInboxSubscriptionId, listInbox, projectInsightsToInbox, recordDecision, recordFeedback, transitionInboxItem, wakeSnoozedItems } from './repository.js';
import type { InboxStatus } from './types.js';

export class ProactiveInboxService {
  list = listInbox;
  project = projectInsightsToInbox;
  wakeSnoozed = wakeSnoozedItems;
  decide = recordDecision;
  feedback = recordFeedback;

  instruct(id: string, instruction: string): { revisionId: string } {
    const revision = publishInstructionFeedback({
      subscriptionId: getInboxSubscriptionId(id),
      inboxItemId: id,
      instruction,
    });
    return { revisionId: revision.id };
  }

  transition(id: string, input: { status: InboxStatus; snoozedUntil?: string; resolution?: string }) {
    return transitionInboxItem(id, input);
  }
}
