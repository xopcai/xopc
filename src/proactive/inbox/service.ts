import { requireMailFollowUp, updateMailFollowUp } from '../follow-ups.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { executePendingProactiveActions } from '../actions/service.js';
import { publishInstructionFeedback } from '../scenarios/repository.js';

import { getInboxItem, getInboxSubscriptionId, listInbox, projectInsightsToInbox, recordDecision, recordFeedback, transitionInboxItem, wakeSnoozedItems } from './repository.js';
import type { InboxStatus } from './types.js';

export class ProactiveInboxService {
  list = listInbox;
  project = projectInsightsToInbox;
  wakeSnoozed = wakeSnoozedItems;
  feedback = recordFeedback;

  decide(id: string, choice: string, note = '') {
    const item = recordDecision(id, choice, note);
    if (choice === 'approve') executePendingProactiveActions();
    return getInboxItem(id) ?? item;
  }

  instruct(id: string, instruction: string) {
    const row = getSqliteDatabase().prepare(`SELECT s.workspace_id, c.content_json FROM proactive_inbox_items i
      JOIN proactive_insights x USING(insight_id) JOIN proactive_runs r USING(run_id)
      JOIN proactive_scenario_subscriptions s ON s.subscription_id = x.subscription_id
      JOIN proactive_context_snapshots c ON c.snapshot_id = r.context_snapshot_id WHERE i.inbox_item_id = ?`)
      .get(id) as { workspace_id: string; content_json: string } | undefined;
    const followId = row && (JSON.parse(row.content_json) as { follow_up?: { followUpId?: string } }).follow_up?.followUpId;
    if (row && followId) {
      const follow = requireMailFollowUp(row.workspace_id, followId);
      const updated = updateMailFollowUp(row.workspace_id, follow.id, {
        expectedRevision: follow.revision, instructions: `${follow.instructions}\n${instruction}`,
      });
      return { followUpId: updated.id, revision: updated.revision };
    }
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
