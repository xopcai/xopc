// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConversationPlanDock } from '@/features/chat/messages/conversation-plan-dock';

const labels = {
  heading: 'Plan',
  stepProgress: 'Step {{current}} / {{total}}',
  completedProgress: '{{completed}} / {{total}} completed',
  finished: 'Plan completed',
  ended: 'Plan ended',
  planned: 'Plan ready',
  filesChangedOne: '{{count}} file changed',
  filesChangedOther: '{{count}} files changed',
};

describe('ConversationPlanDock', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('opens the step list from the compact progress pill', async () => {
    act(() => {
      root.render(
        <ConversationPlanDock
          plan={{
            source: 'update_plan',
            items: [
              { id: 'inventory', title: 'Inventory current behavior', status: 'completed' },
              { id: 'render', title: 'Render the plan card', status: 'in_progress' },
            ],
            explanation: 'Keep the current task visible.',
            currentIndex: 2,
            completedCount: 1,
            totalCount: 2,
          }}
          changeSummary={{ files: ['message-bubble.tsx'], added: 24, removed: 3 }}
          isStreaming
          labels={labels}
        />,
      );
    });

    const trigger = container.querySelector('button');
    expect(trigger?.textContent).toContain('Step 2 / 2');
    expect(trigger?.getAttribute('aria-label')).toContain('Render the plan card');

    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Inventory current behavior');
    expect(document.body.textContent).toContain('1 file changed · +24 -3');
  });

  it('distinguishes a cancelled plan from a fully completed plan', () => {
    act(() => {
      root.render(
        <ConversationPlanDock
          plan={{
            source: 'todo',
            items: [
              { id: 'done', title: 'Completed item', status: 'completed' },
              { id: 'cancelled', title: 'Cancelled item', status: 'cancelled' },
            ],
            completedCount: 1,
            totalCount: 2,
          }}
          changeSummary={null}
          isStreaming={false}
          labels={labels}
        />,
      );
    });

    expect(container.querySelector('button')?.textContent).toContain('Plan ended');
    expect(container.querySelector('button')?.textContent).not.toContain('Plan completed');
  });
});
