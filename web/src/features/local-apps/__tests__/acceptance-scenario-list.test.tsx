import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AcceptanceScenarioList } from '@/features/local-apps/acceptance-scenario-list';

describe('AcceptanceScenarioList', () => {
  const scenarios = [
    { id: 'create-item', name: 'Create an item', stepCount: 3 },
    { id: 'delete-item', name: 'Delete an item', stepCount: 2 },
  ];

  it('shows per-scenario results and failure actions', () => {
    const html = renderToStaticMarkup(
      <AcceptanceScenarioList
        scenarios={scenarios}
        results={{
          'create-item': { id: 'create-item', name: 'Create an item', status: 'passed', message: 'Scenario passed', failureKind: 'scenario' },
          'delete-item': { id: 'delete-item', name: 'Delete an item', status: 'failed', message: 'Step 2: target was not found', failureKind: 'scenario' },
        }}
        runningTarget={null}
        zh={false}
        onRunAll={vi.fn()}
        onRunScenario={vi.fn()}
        onAskCoder={vi.fn()}
      />,
    );

    expect(html).toContain('2 critical user journeys');
    expect(html).toContain('Create an item');
    expect(html).toContain('Step 2: target was not found');
    expect(html).toContain('Ask Coder to fix');
    expect(html).toContain('Rerun Delete an item');
  });

  it('offers Coder diagnostics when the runner failed', () => {
    const html = renderToStaticMarkup(
      <AcceptanceScenarioList
        scenarios={[scenarios[0]]}
        results={{
          'create-item': {
            id: 'create-item',
            name: 'Create an item',
            status: 'failed',
            message: 'The acceptance runner did not connect.',
            failureKind: 'runner',
          },
        }}
        runningTarget={null}
        zh={false}
        onRunAll={vi.fn()}
        onRunScenario={vi.fn()}
        onAskCoder={vi.fn()}
      />,
    );

    expect(html).toContain('Ask Coder to fix');
    expect(html).toContain('Rerun Create an item');
  });

  it('shows isolated execution while a single scenario reruns', () => {
    const html = renderToStaticMarkup(
      <AcceptanceScenarioList
        scenarios={scenarios}
        results={{}}
        runningTarget="create-item"
        zh
        onRunAll={vi.fn()}
        onRunScenario={vi.fn()}
        onAskCoder={vi.fn()}
      />,
    );

    expect(html).toContain('正在隔离预览中执行');
    expect(html).toContain('等待运行');
  });
});
