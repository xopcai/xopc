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
  isLoading: false,
}) }));
vi.mock('../models-hub-cache', () => ({
  MODEL_CATALOG_SWR_KEY: 'model-catalog', CAPABILITY_READINESS_SWR_KEY: 'capability-readiness',
  revalidateModelsHubCaches: vi.fn(),
}));

import { ModelCatalogStatus } from '../model-catalog-status';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const previousApi = window.electronAPI;
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  window.electronAPI = previousApi;
  mockState.catalog = { sources: {}, references: [], sync: { refreshing: false } };
  mockState.catalogError = null;
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

it('links every available capability card to its configuration page', async () => {
  window.electronAPI = undefined;
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter><ModelCatalogStatus /></MemoryRouter>));

  expect(container.querySelector('a[href="/settings/capabilities/models"]')?.textContent).toMatch(/Vision|图片理解/);
  expect(container.querySelector('a[href="/settings/capabilities/image"]')?.textContent).toMatch(/Image generation|图片生成/);
  const voiceCards = container.querySelectorAll('a[href="/settings/capabilities/voice"]');
  expect(voiceCards).toHaveLength(2);
  expect(Array.from(voiceCards, card => card.textContent)).toEqual(expect.arrayContaining([
    expect.stringMatching(/STT/),
    expect.stringMatching(/TTS/),
  ]));
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
  expect(container.querySelector('a[href="/settings/agent-defaults"]')).not.toBeNull();
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
