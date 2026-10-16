// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useGatewayStore } from '@/stores/gateway-store';

const mocks = vi.hoisted(() => ({ save: vi.fn(), defaults: { models: { chat: { primary: 'cloud/chat', fallbacks: [] } } } }));
vi.mock('swr', () => ({ default: () => ({ data: { defaults: mocks.defaults, builtinTools: [] } }) }));
vi.mock('@/features/settings/global-defaults-api', () => ({ fetchGlobalDefaults: vi.fn(), updateGlobalDefaults: mocks.save }));
vi.mock('../agent-defaults-skills-panel', () => ({ AgentDefaultsSkillsPanel: () => <div data-testid="skills" /> }));
vi.mock('../agent-defaults-tools-panel', () => ({ AgentDefaultsToolsPanel: () => <div data-testid="tools" /> }));
vi.mock('../agent-defaults-runtime-panel', () => ({ AgentDefaultsRuntimePanel: () => <div data-testid="runtime" /> }));
import { AgentDefaultsSettingsPanel } from '../agent-defaults-settings-panel';

let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const priorSession = useGatewayStore.getState().conversationId;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); mocks.save.mockClear(); useGatewayStore.setState({ conversationId: 'test' }); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); useGatewayStore.setState({ conversationId: priorSession }); });
function Location() { const location = useLocation(); return <output data-return={location.state?.returnTo}>{location.pathname + location.search}</output>; }
const render = (search = '') => act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: '/settings/agent-defaults', search, state: { returnTo: '/chat/origin' } }]}><Routes><Route path="/settings/agent-defaults" element={<AgentDefaultsSettingsPanel />} /><Route path="/settings/capabilities/models" element={<Location />} /></Routes></MemoryRouter>));
it.each(['', '?panel=skills', '?panel=tools', '?panel=runtime'])('keeps agent-specific settings without duplicating shared models: %s', async search => {
  await render(search);
  expect(container.querySelectorAll('nav button')).toHaveLength(3);
  expect(container.querySelector(`[data-testid="${search.split('=')[1] ?? 'skills'}"]`)).not.toBeNull();
  expect(container.textContent).not.toMatch(/Shared models|共用模型|cloud\/chat/);
  expect(mocks.save).not.toHaveBeenCalled();
});
it('uses the default skills panel for unsupported sections without maintaining model aliases', async () => {
  await render('?panel=models');
  expect(container.querySelector('[data-testid="skills"]')).not.toBeNull();
  expect(container.querySelector('output')).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
});
