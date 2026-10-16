// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

interface CatalogTestPayload {
  sources: Record<string, { lastSuccessAt: number; models: Array<{ availability: 'available' | 'unavailable' }> }>;
  references: Array<{
    ref: string;
    availability: 'available' | 'unavailable';
    locations: string[];
    suggestedRef?: string;
  }>;
  sync: {
    refreshing: boolean;
    lastAttemptAt?: number;
    lastSuccessAt?: number;
    lastError?: string;
    sourceErrors?: Record<string, string>;
  };
}

const mockState = vi.hoisted(() => {
  const catalog: CatalogTestPayload = {
    sources: {},
    references: [],
    sync: { refreshing: false },
  };
  const catalogError: Error | null = null;
  return {
    catalog,
    catalogError,
    loading: false,
    capabilities: {
      vision: { status: 'ready', selectionSource: 'explicit-config', primary: { provider: 'cloud', model: 'vision' } },
      'image-generation': { status: 'ready', selectionSource: 'explicit-config', primary: { provider: 'cloud', model: 'image' } },
      stt: { status: 'ready', selectionSource: 'explicit-config', primary: { provider: 'cloud', model: 'stt' } },
      tts: { status: 'ready', selectionSource: 'explicit-config', primary: { provider: 'cloud', model: 'tts' } },
      'computer-use': { status: 'unavailable', selectionSource: 'explicit-config', rejected: [{ provider: 'cloud', model: 'gui' }] },
    },
  };
});

vi.mock('swr', () => ({ default: (key: string) => ({
  data: key === 'model-catalog' ? mockState.catalog : { capabilities: mockState.capabilities },
  error: key === 'model-catalog' ? mockState.catalogError : null,
  isLoading: key === 'model-catalog' && mockState.loading,
}) }));
vi.mock('../models-hub-cache', () => ({
  MODEL_CATALOG_SWR_KEY: 'model-catalog', CAPABILITY_READINESS_SWR_KEY: 'capability-readiness',
  revalidateModelsHubCaches: vi.fn(),
}));

import { ModelCatalogStatus } from '../model-catalog-status';
import { openCapabilitySettings } from '../open-capability-settings';
vi.mock('../open-capability-settings', () => ({ openCapabilitySettings: vi.fn() }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const previousApi = window.electronAPI;
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  window.electronAPI = previousApi;
  vi.mocked(openCapabilitySettings).mockClear();
  mockState.catalog = { sources: {}, references: [], sync: { refreshing: false } };
  mockState.catalogError = null;
  mockState.loading = false;
  Object.assign(mockState.capabilities, {
    vision: { status: 'ready', selectionSource: 'explicit-config', primary: { provider: 'cloud', model: 'vision' } },
    'image-generation': { status: 'ready', selectionSource: 'explicit-config', primary: { provider: 'cloud', model: 'image' } },
    stt: { status: 'ready', selectionSource: 'explicit-config', primary: { provider: 'cloud', model: 'stt' } },
    tts: { status: 'ready', selectionSource: 'explicit-config', primary: { provider: 'cloud', model: 'tts' } },
    'computer-use': { status: 'unavailable', selectionSource: 'explicit-config', rejected: [{ provider: 'cloud', model: 'gui' }] },
  });
});

it.each(['darwin', 'win32', 'linux', undefined])('shows computer setup and its warning only on macOS desktop: %s', async platform => {
  window.electronAPI = platform ? { platform } as Window['electronAPI'] : undefined;
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter><ModelCatalogStatus /></MemoryRouter>));
  expect(Boolean(container.querySelector('a[href="/settings/computer-use"]'))).toBe(platform === 'darwin');
  expect(Boolean(container.querySelector('.lucide-triangle-alert'))).toBe(platform === 'darwin');
  expect(container.textContent).toMatch(/Vision|图片理解/);
});

it('opens each model capability in its settings dialog instead of navigating', async () => {
  window.electronAPI = undefined;
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter><ModelCatalogStatus /></MemoryRouter>));
  const cards = container.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]');
  expect(cards).toHaveLength(4);
  expect(container.querySelector('a[href^="/settings/capabilities/"]')).toBeNull();
  for (const card of cards) await act(async () => card.click());
  expect(vi.mocked(openCapabilitySettings).mock.calls).toEqual([
    ['vision', 'settings'], ['image', 'settings'], ['transcription', 'settings'], ['speech', 'settings'],
  ]);
});

it('opens a misconfigured speech capability directly in the service connection tab', async () => {
  window.electronAPI = undefined;
  Object.assign(mockState.capabilities.stt, { status: 'unavailable', rejected: [{ provider: 'cloud', model: 'stt' }] });
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter><ModelCatalogStatus /></MemoryRouter>));
  const card = [...container.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')].find(button => button.textContent?.includes('STT'))!;
  await act(async () => card.click());
  expect(openCapabilitySettings).toHaveBeenCalledExactlyOnceWith('transcription', 'services');
});

it('presents never-configured optional capabilities without warnings', async () => {
  window.electronAPI = undefined;
  Object.assign(mockState.capabilities, {
    vision: { status: 'unavailable', selectionSource: 'none', rejected: [] },
    'image-generation': { status: 'unavailable', selectionSource: 'none', rejected: [] },
    stt: { status: 'unavailable', selectionSource: 'none', rejected: [] },
    tts: { status: 'ready', selectionSource: 'credentialless-fallback', primary: { provider: 'edge', model: 'edge' } },
  });
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter><ModelCatalogStatus /></MemoryRouter>));

  expect(container.textContent).toContain('Not configured');
  expect(container.textContent).not.toContain('Needs attention');
  expect(container.querySelector('.lucide-triangle-alert')).toBeNull();
});

it('presents provider sync failures as temporarily unverified with repair actions', async () => {
  window.electronAPI = undefined;
  mockState.catalog = {
    sources: {},
    references: [{
      ref: 'deepseek/deepseek-v4-flash',
      availability: 'unavailable',
      locations: ['agentCatalog.defaults.models.chat.primary'],
      suggestedRef: 'deepseek/deepseek-v3',
    }],
    sync: {
      refreshing: false,
      lastAttemptAt: 1_750_000_000_000,
      sourceErrors: { deepseek: 'fetch failed' },
    },
  };
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter><ModelCatalogStatus /></MemoryRouter>));

  expect(container.textContent).toContain('Temporarily unverified');
  expect(container.textContent).not.toContain('deepseek/deepseek-v4-flash is unavailable');
  expect(container.textContent).toContain('Check again');
  expect(container.textContent).toContain('Replace model');
  expect(container.textContent).toContain('View 1 reference');
  expect(container.querySelector('a[href="/settings/capabilities/models"]')).not.toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('[aria-label="Sync error details"]')?.textContent).toContain('deepseek: fetch failed');
});

it('keeps confirmed unresolved references actionable without exposing a generic page error', async () => {
  window.electronAPI = undefined;
  mockState.catalog = {
    sources: {},
    references: [{
      ref: 'removed/model',
      availability: 'unavailable',
      locations: ['agentCatalog.agents.reviewer.models.intents.review.primary'],
    }],
    sync: { refreshing: false, lastSuccessAt: 1_750_000_000_000 },
  };
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter><ModelCatalogStatus /></MemoryRouter>));

  expect(container.textContent).toContain('Unavailable');
  expect(container.textContent).toContain('Adjust configuration');
  expect(container.textContent).toContain('Agent reviewer');
  expect(container.querySelector('a[href="/capabilities/agents/reviewer"]')).not.toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});


it('retains the expanded capability list when an inline repair refreshes its status', async () => {
  window.electronAPI = undefined;
  Object.assign(mockState.capabilities.stt, { status: 'unavailable', rejected: [{ provider: 'cloud', model: 'stt' }] });
  const container = document.createElement('div'); root = createRoot(container);
  const render = () => root!.render(<MemoryRouter><ModelCatalogStatus /></MemoryRouter>);
  await act(async () => render());
  const details = container.querySelector('details')!;
  expect(details.open).toBe(true);
  Object.assign(mockState.capabilities.stt, { status: 'ready', rejected: [] });
  await act(async () => render());
  expect(details.open).toBe(true);
  details.open = false;
  await act(async () => render());
  expect(details.open).toBe(false);
});


it('opens an actionable warning when readiness arrives before the model catalog', async () => {
  window.electronAPI = undefined;
  mockState.loading = true;
  Object.assign(mockState.capabilities.stt, { status: 'unavailable', rejected: [{ provider: 'cloud', model: 'stt' }] });
  const container = document.createElement('div'); root = createRoot(container);
  const render = () => root!.render(<MemoryRouter><ModelCatalogStatus /></MemoryRouter>);
  await act(async () => render());
  expect(container.querySelector('details')).toBeNull();
  mockState.loading = false;
  await act(async () => render());
  expect(container.querySelector('details')?.open).toBe(true);
});

it('keeps catalog diagnostics without duplicating capability configuration in the merged overview', async () => {
  mockState.catalog.sync.sourceErrors = { cloud: 'Connection unavailable' };
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter><ModelCatalogStatus showCapabilities={false} /></MemoryRouter>));
  expect(container.querySelector('button[aria-haspopup="dialog"]')).toBeNull();
  expect(container.textContent).not.toMatch(/Optional capabilities|可选能力/);
  expect(container.textContent).toContain('Connection unavailable');
});
