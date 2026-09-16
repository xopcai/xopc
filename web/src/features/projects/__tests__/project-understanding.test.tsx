// @vitest-environment jsdom

import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { fetchProjectUnderstanding, startProjectUnderstanding } from '../project-understanding-api';
import { ProjectUnderstandingCheckbox, ProjectUnderstandingPanel } from '../project-understanding';

vi.mock('../project-understanding-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../project-understanding-api')>(),
  fetchProjectUnderstanding: vi.fn(), startProjectUnderstanding: vi.fn(), correctProjectUnderstanding: vi.fn(),
}));

describe('quiet project understanding controls', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useGatewayStore.setState({ conversationId: 'test' });
    useLocaleStore.setState({ language: 'en' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const renderPanel = async () => act(async () => root.render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ProjectUnderstandingPanel projectId="project-1" />
    </SWRConfig>,
  ));

  it('lets a user opt out with one click without launching work', async () => {
    function Form() {
      const [checked, setChecked] = useState(true);
      return <ProjectUnderstandingCheckbox checked={checked} onChange={setChecked} />;
    }
    await act(async () => root.render(<Form />));
    const checkbox = container.querySelector('input')!;
    expect(checkbox.checked).toBe(true);
    await act(async () => checkbox.click());
    expect(checkbox.checked).toBe(false);
    expect(startProjectUnderstanding).not.toHaveBeenCalled();
  });

  it('keeps completed understanding collapsed and never starts analysis just by viewing a project', async () => {
    vi.mocked(fetchProjectUnderstanding).mockResolvedValue({ status: 'completed', overview: 'Documented project facts', updatedAt: 1 });
    await renderPanel();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(container.querySelector('details')?.open).toBe(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain('View project overview');
    expect(startProjectUnderstanding).not.toHaveBeenCalled();
  });

  it('retries with one click and shows a quiet running state', async () => {
    vi.mocked(fetchProjectUnderstanding).mockResolvedValue({ status: 'failed', overview: null, updatedAt: null });
    vi.mocked(startProjectUnderstanding).mockImplementation(async () => {
      vi.mocked(fetchProjectUnderstanding).mockResolvedValue({ status: 'queued', overview: null, updatedAt: null });
      return { status: 'queued' };
    });
    await renderPanel();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry')!;
    await act(async () => retry.click());
    expect(startProjectUnderstanding).toHaveBeenCalledExactlyOnceWith('project-1');
    expect(container.textContent).toContain('Learning about this project');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
