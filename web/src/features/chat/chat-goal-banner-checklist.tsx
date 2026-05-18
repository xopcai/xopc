import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { type postWebchatChecklistMutation, type WebchatPersistentGoalWire } from '@/features/chat/goals-api';
import { cn } from '@/lib/cn';

import { itemMarker, type GoalMessages } from './chat-goal-banner-utils';

type ChecklistMutation = Parameters<typeof postWebchatChecklistMutation>[1];

type Props = {
  goal: WebchatPersistentGoalWire;
  canEdit: boolean;
  mutationBusy: boolean;
  t: GoalMessages;
  onMutate: (m: ChecklistMutation) => void | Promise<void>;
};

export function GoalChecklist({ goal, canEdit, mutationBusy, t, onMutate }: Props) {
  const [newCriterion, setNewCriterion] = useState('');
  const items = goal.checklist ?? [];

  return (
    <div className="rounded-xl bg-surface-muted/70 px-2.5 py-2 dark:bg-surface-muted/40">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-muted">{t.checklistHeading}</p>
      {items.length === 0 ? (
        <p className="text-xs text-fg-muted">{t.checklistEmpty}</p>
      ) : (
        <ul className="max-h-36 space-y-1.5 overflow-y-auto pr-0.5 text-xs">
          {items.map((it, i) => {
            const n = i + 1;
            return (
              <li
                key={`${n}-${it.text.slice(0, 24)}`}
                className="flex items-start gap-2 rounded-md border border-transparent px-1 py-0.5 hover:border-edge/60"
              >
                <span className="mt-0.5 w-4 shrink-0 text-center text-fg-muted" title={it.status}>
                  {itemMarker(it)}
                </span>
                <span className="min-w-0 flex-1 text-fg">{it.text}</span>
                {canEdit && it.status === 'pending' ? (
                  <span className="flex shrink-0 gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 px-1.5 text-[11px] text-accent"
                      disabled={mutationBusy}
                      onClick={() => void onMutate({ op: 'mark', index: n, status: 'completed' })}
                    >
                      {t.markDone}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 px-1.5 text-[11px] text-fg-muted"
                      disabled={mutationBusy}
                      onClick={() => void onMutate({ op: 'mark', index: n, status: 'impossible' })}
                    >
                      {t.markBlocked}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 px-1.5 text-[11px] text-destructive"
                      disabled={mutationBusy}
                      onClick={() => void onMutate({ op: 'remove', index: n })}
                    >
                      {t.removeItem}
                    </Button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
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
