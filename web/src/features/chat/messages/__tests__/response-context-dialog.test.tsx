// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ResponseContextDialog,
  type ResponsePersonalContext,
} from '@/features/chat/messages/response-context-dialog';

const labels = {
  title: 'Why this answer was personalized',
  hint: 'These parts of your personal context were allowed to shape the response.',
  close: 'Close personal context',
  itemsSummary: '{{count}} context items influenced this answer',
  groupSummary: 'Organized into {{count}} groups',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  origins: {
    told_by_user: 'You told me',
    observed: 'Noticed across your work',
    inferred: 'My interpretation',
    connected_source: 'From {{source}}',
  },
};

const items: ResponsePersonalContext[] = [
  ...Array.from({ length: 4 }, (_, index) => ({
    id: `told:${index}`,
    statement: `User preference ${index + 1}`,
    origin: 'told_by_user' as const,
    sourceName: '',
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    id: `observed:${index}`,
    statement: `Observed preference ${index + 1}`,
    origin: 'observed' as const,
    sourceName: '',
  })),
  {
    id: 'observed:duplicate',
    statement: 'Observed   preference 1',
    origin: 'observed',
    sourceName: '',
  },
];

describe('ResponseContextDialog', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('groups long context lists and progressively discloses their contents', () => {
    act(() => {
      root.render(
        <ResponseContextDialog
          open
          onOpenChange={() => undefined}
          items={items}
          labels={labels}
        />,
      );
    });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="response-context-scroll-region"]')).not.toBeNull();
    expect(document.body.textContent).toContain('8 context items influenced this answer');
    expect(document.body.textContent).toContain('Organized into 2 groups');

    const groupButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('section > button'));
    expect(groupButtons).toHaveLength(2);
    expect(groupButtons[0].getAttribute('aria-expanded')).toBe('true');
    expect(groupButtons[1].getAttribute('aria-expanded')).toBe('false');
    expect(document.body.textContent).toContain('User preference 1');
    expect(document.body.textContent).not.toContain('Observed preference 1');

    const expandAll = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Expand all') as HTMLButtonElement;
    act(() => expandAll.click());

    expect(groupButtons.every((button) => button.getAttribute('aria-expanded') === 'true')).toBe(true);
    expect(document.body.textContent).toContain('Observed preference 1');
  });
});
