// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExternalRuntimeQuickCards } from '@/features/settings/agents/external-runtime-config';
import type { ExternalRuntimeProbeResult, GatewayAgentRow } from '@/features/settings/types/agent-gateway';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const missingProbes: ExternalRuntimeProbeResult[] = [
  { kind: 'codex', label: 'Codex', status: 'not_installed', installed: false, checkedAt: 1, models: [] },
  { kind: 'agy', label: 'Antigravity', status: 'not_installed', installed: false, checkedAt: 1, models: [] },
  { kind: 'claude', label: 'Claude Code', status: 'not_installed', installed: false, checkedAt: 1, models: [] },
];

const readyProbes: ExternalRuntimeProbeResult[] = [
  {
    kind: 'codex',
    label: 'Codex',
    status: 'ready',
    installed: true,
    checkedAt: 1,
    version: '0.171.0',
    models: [{ id: 'gpt-5.4-codex', label: 'GPT-5.4 Codex', isDefault: true }],
    rateLimits: { primary: { usedPercent: 35, windowDurationMins: 300 } },
  },
  { kind: 'agy', label: 'Antigravity', status: 'not_installed', installed: false, checkedAt: 1, models: [] },
  { kind: 'claude', label: 'Claude Code', status: 'ready', installed: true, checkedAt: 1, version: '2.1.0', models: [] },
];

describe('ExternalRuntimeQuickCards', () => {
  it('stays completely hidden when no external agent is configured and no host CLI is detected', async () => {
    await act(async () => {
      root.render(
        <ExternalRuntimeQuickCards
          runtimes={missingProbes}
          loading={false}
          refreshing={false}
          agents={[]}
          zh
          onRefresh={vi.fn()}
          onAddRuntime={vi.fn()}
          onOpenAgent={vi.fn()}
        />,
      );
    });

    expect(container.innerHTML).toBe('');
  });

  it('renders a collapsed single-row strip by default and expands to manage runtimes without rate-limit clutter', async () => {
    const onAdd = vi.fn();
    const codexAgent = {
      id: 'codex-1',
      name: 'Codex',
      override: { id: 'codex-1', enabled: true, execution: { kind: 'codex' } },
    } as unknown as GatewayAgentRow;

    await act(async () => {
      root.render(
        <ExternalRuntimeQuickCards
          runtimes={readyProbes}
          loading={false}
          refreshing={false}
          agents={[codexAgent]}
          zh
          onRefresh={vi.fn()}
          onAddRuntime={onAdd}
          onOpenAgent={vi.fn()}
        />,
      );
    });

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    expect(toggle).not.toBeNull();
    expect(container.textContent).toContain('本机编程运行时');
    expect(container.textContent).toContain('Codex');
    expect(container.textContent).toContain('Claude');
    expect(container.textContent).not.toContain('35%');
    expect(container.textContent).not.toContain('重新检测');

    await act(async () => toggle!.click());
    expect(container.querySelector('button[aria-expanded="true"]')).not.toBeNull();
    expect(container.textContent).toContain('重新检测');
    expect(container.textContent).toContain('接入 Claude');
    expect(container.textContent).not.toContain('35%');
  });
});
