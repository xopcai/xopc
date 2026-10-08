// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { ModelRoute } from '@/features/settings/types/agent-gateway';

const fixture = vi.hoisted(() => ({
  loading: false,
  models: [
    { id: 'test/one', name: 'One', provider: 'test' },
    { id: 'test/two', name: 'Two', provider: 'test' },
    { id: 'test/vision', name: 'Vision', provider: 'test', vision: true },
    { id: 'test/vision-two', name: 'Vision Two', provider: 'test', vision: true },
  ],
  images: [{ id: 'images', label: 'Images', models: ['paint', 'draw'] }],
}));
vi.mock('swr', () => ({ default: (key: string | null) => ({
  data: key === null ? undefined : key === 'agent-defaults-image-models' ? fixture.images : fixture.models,
  isLoading: key !== null && fixture.loading,
}) }));

import { ModelRouteEditor } from '../agent-model-route-editor';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
let current: ModelRoute | null | undefined;
const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
};
const named = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const option = (id: string) => document.querySelector<HTMLButtonElement>(`button[title="${id}"]`)!;
const button = (text: string) => [...document.querySelectorAll('button')].find((node) => node.textContent === text)!;

beforeEach(() => {
  fixture.loading = false;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function render(value: ModelRoute | null | undefined, modelKind: 'text' | 'vision' | 'image' = 'text') {
  function Harness() {
    const [route, setRoute] = useState(value);
    current = route;
    return <ModelRouteEditor label="对话" value={route} inherited={{ primary: 'test/one', fallbacks: ['test/two'] }}
      zh modelKind={modelKind} allowChatFallback allowDisabled onChange={setRoute} />;
  }
  await act(async () => root.render(<MemoryRouter><Harness /></MemoryRouter>));
}

it('selects primary and ordered fallbacks while excluding duplicate candidates', async () => {
  await render({ primary: 'test/one', fallbacks: ['test/two'] });
  expect(container.querySelector('input')).toBeNull();
  await click(named('对话主模型'));
  await click(option('test/vision'));
  expect(current).toEqual({ primary: 'test/vision', fallbacks: ['test/two'] });
  await click(named('添加回退模型'));
  expect(option('test/vision')).toBeNull();
  expect(option('test/two')).toBeNull();
  await click(option('test/one'));
  expect(current?.fallbacks).toEqual(['test/two', 'test/one']);
  await click(named('移除 test/two'));
  expect(current?.fallbacks).toEqual(['test/one']);
});

it('preserves unavailable saved models until a replacement is selected', async () => {
  await render({ primary: 'removed/model', fallbacks: ['removed/fallback'] });
  await click(named('对话主模型'));
  expect(named('对话主模型').textContent).toContain('removed/model');
  await click(option('test/one'));
  expect(current).toEqual({ primary: 'test/one', fallbacks: ['removed/fallback'] });
});

it('retains customize, inherit, use Chat and disable semantics', async () => {
  await render(undefined);
  await click(button('自定义'));
  expect(current).toEqual({ primary: 'test/one', fallbacks: ['test/two'] });
  await click(button('使用 Chat'));
  expect(current).toBeNull();
  await click(button('继承'));
  expect(current).toBeUndefined();
  await click(button('自定义'));
  await click(button('禁用'));
  expect(current).toBeNull();
});

it('filters image understanding primary and fallback options to vision models', async () => {
  await render({ primary: 'test/vision', fallbacks: [] }, 'vision');
  await click(named('对话主模型'));
  expect(option('test/one')).toBeNull();
  await click(option('test/vision-two'));
  await click(named('添加回退模型'));
  expect(option('test/one')).toBeNull();
  await click(option('test/vision'));
  expect(current?.fallbacks).toEqual(['test/vision']);
});

it('uses the image generation catalog for both selectors', async () => {
  await render({ primary: 'images/paint', fallbacks: [] }, 'image');
  await click(named('对话主模型'));
  expect(option('test/one')).toBeNull();
  await click(option('images/draw'));
  await click(named('添加回退模型'));
  await click(option('images/paint'));
  expect(current).toEqual({ primary: 'images/draw', fallbacks: ['images/paint'] });
});

it('shows skeletons while the catalog loads', async () => {
  fixture.loading = true;
  await render({ primary: 'test/one', fallbacks: [] });
  expect(named('对话主模型')).toBeNull();
  expect(named('添加回退模型')).toBeNull();
  expect(container.querySelectorAll('.animate-pulse')).toHaveLength(2);
});
