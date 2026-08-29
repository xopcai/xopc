// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkDiscoveryRun } from '../api';
import { UnderstandingReveal } from '../understanding-reveal';

const run: WorkDiscoveryRun = {
  id: 'run-1',
  status: 'completed',
  rootPath: '/work/xopc',
  projectId: 'project-1',
  sessionKey: 'session-1',
  result: {
    projectSummary: 'xopc is a software project.',
    currentState: 'The onboarding flow is being refined.',
    uncertainties: [],
    suggestions: [],
    lowConfidence: false,
  },
};

describe('UnderstandingReveal', () => {
  let container: HTMLDivElement;
  let root: Root;

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
    vi.restoreAllMocks();
  });

  it('sends an entered correction directly to the project conversation', async () => {
    const onFinish = vi.fn(async () => true);
    const onStartConversation = vi.fn(async () => true);
    act(() => {
      root.render(
        <UnderstandingReveal
          run={run}
          sourceMemories={[]}
          focuses={[]}
          activityRunning={false}
          language="en"
          busy={false}
          error={null}
          onReviewMemory={async () => true}
          onReviewFocus={async () => true}
          onFinish={onFinish}
          onStartConversation={onStartConversation}
        />,
      );
    });

    const adjust = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Adjust');
    await act(async () => adjust?.click());

    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    act(() => {
      valueSetter?.call(textarea, 'Explain the onboarding changes first.');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const continueButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Continue with this understanding');
    await act(async () => continueButton?.click());

    expect(onStartConversation).toHaveBeenCalledWith(
      'Explain the onboarding changes first.',
      'corrected',
    );
    expect(onFinish).not.toHaveBeenCalled();
  });
});
