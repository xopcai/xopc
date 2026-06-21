import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  type postWebchatChecklistMutation,
  type WebchatChecklistItemWire,
  type WebchatPersistentGoalWire,
} from '@/features/chat/goals/goals-api';
import { cn } from '@/lib/cn';

import { itemMarker, type GoalMessages } from './chat-goal-banner-utils';

type ChecklistMutation = Parameters<typeof postWebchatChecklistMutation>[1];

type ChecklistItemWithIndex = WebchatChecklistItemWire & { index1Based: number };

type Props = {
  goal: WebchatPersistentGoalWire;
  canEdit: boolean;
  mutationBusy: boolean;
  t: GoalMessages;
  onMutate: (m: ChecklistMutation) => void | Promise<void>;
};

type GoalMessagesWithChecklistBoardCopy = GoalMessages & {
  pendingGroup?: string;
  completedGroup?: string;
  impossibleGroup?: string;
  judgeGenerated?: string;
  userAdded?: string;
  evidenceLabel?: string;
};

function groupedItems(items: WebchatChecklistItemWire[]): {
  pending: ChecklistItemWithIndex[];
  completed: ChecklistItemWithIndex[];
  impossible: ChecklistItemWithIndex[];
} {
  const groups = {
    pending: [] as ChecklistItemWithIndex[],
    completed: [] as ChecklistItemWithIndex[],
    impossible: [] as ChecklistItemWithIndex[],
  };
  items.forEach((item, index) => {
    groups[item.status].push({ ...item, index1Based: index + 1 });
  });
  return groups;
}

export function GoalChecklist({ goal, canEdit, mutationBusy, t, onMutate }: Props) {
  const [newCriterion, setNewCriterion] = useState('');
  const items = goal.checklist ?? [];
  const groups = groupedItems(items);
  const copy = t as GoalMessagesWithChecklistBoardCopy;

  const renderGroup = (title: string, rows: ChecklistItemWithIndex[]) => {
    if (rows.length === 0) return null;
    return (
      <section className="space-y-1">
        <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-fg-muted">
          <span>{title}</span>
          <span>{rows.length}</span>
        </div>
        <ul className="space-y-1.5">
          {rows.map((it) => (
            <li
              key={`${it.index1Based}-${it.text.slice(0, 24)}`}
              className="rounded-md border border-transparent px-1.5 py-1 hover:border-edge/60 hover:bg-surface-panel/70"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-4 shrink-0 text-center text-fg-muted" title={it.status}>
                  {itemMarker(it)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-fg">{it.text}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-fg-muted">
                    <span className="rounded-full bg-surface-panel px-1.5 py-0.5">
                      {it.addedBy === 'user' ? (copy.userAdded ?? 'User') : (copy.judgeGenerated ?? 'Judge')}
                    </span>
                    {it.evidenceSummary ? (
                      <span className="min-w-0 break-words">
                        {(copy.evidenceLabel ?? 'Evidence')}: {it.evidenceSummary}
                      </span>
                    ) : null}
                  </div>
                </div>
                {canEdit && it.status === 'pending' ? (
                  <span className="flex shrink-0 flex-wrap justify-end gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 px-1.5 text-[11px] text-accent"
                      disabled={mutationBusy}
                      onClick={() => void onMutate({ op: 'mark', index: it.index1Based, status: 'completed' })}
                    >
                      {t.markDone}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 px-1.5 text-[11px] text-fg-muted"
                      disabled={mutationBusy}
                      onClick={() => void onMutate({ op: 'mark', index: it.index1Based, status: 'impossible' })}
                    >
                      {t.markBlocked}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 px-1.5 text-[11px] text-destructive"
                      disabled={mutationBusy}
                      onClick={() => void onMutate({ op: 'remove', index: it.index1Based })}
                    >
                      {t.removeItem}
                    </Button>
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  };

  return (
    <div className="rounded-xl bg-surface-muted/70 px-2.5 py-2 dark:bg-surface-muted/40">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-muted">{t.checklistHeading}</p>
      {items.length === 0 ? (
        <p className="text-xs text-fg-muted">{t.checklistEmpty}</p>
      ) : (
        <div className="max-h-48 space-y-2 overflow-y-auto pr-0.5 text-xs">
          {renderGroup(copy.pendingGroup ?? 'Pending', groups.pending)}
          {renderGroup(copy.completedGroup ?? 'Completed', groups.completed)}
          {renderGroup(copy.impossibleGroup ?? 'Blocked', groups.impossible)}
        </div>
      )}
      {canEdit ? (
        <div className="mt-2 flex gap-1.5">
          <input
            type="text"
            value={newCriterion}
            onChange={(e) => setNewCriterion(e.target.value)}
            placeholder={t.addCriterionPlaceholder}
            className={cn(
              'min-w-0 flex-1 rounded-md border border-edge bg-surface-muted px-2 py-1.5 text-xs text-fg',
              'placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newCriterion.trim()) {
                e.preventDefault();
                void Promise.resolve(onMutate({ op: 'add', text: newCriterion.trim() })).then(() =>
                  setNewCriterion(''),
                );
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            className="h-8 shrink-0 px-2.5 text-xs"
            disabled={mutationBusy || !newCriterion.trim()}
            onClick={() =>
              void Promise.resolve(onMutate({ op: 'add', text: newCriterion.trim() })).then(() => setNewCriterion(''))
            }
          >
            {t.addCriterion}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
