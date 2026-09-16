// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { getChatSkillsCached, type ChatSkillsPayload } from '@/features/chat/palette/command-palette-api';
import { SkillDiscoveryWelcome } from '@/features/skills/skill-discovery-welcome';
import { useSkillsPage, type SkillsPageVm } from '@/features/skills/use-skills-page';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';

vi.mock('@/features/chat/agent-selection/chat-agents-api', () => ({ fetchChatAgents: vi.fn() }));
vi.mock('@/features/chat/palette/command-palette-api', () => ({ getChatSkillsCached: vi.fn() }));
vi.mock('@/features/skills/skill-api', () => ({
  getSkills: vi.fn(async () => ({ catalog: [], diagnostics: [] })),
  getMarketplaceProviders: vi.fn(async () => ({ providers: [], current: null })),
}));

let vm: SkillsPageVm;
let destination: ReturnType<typeof useLocation>;
function SkillsHarness() {
  vm = useSkillsPage();
  return <div>{vm.actionFeedback?.message}</div>;
}
function Destination() {
  destination = useLocation();
  return null;
}
const available: ChatSkillsPayload = {
  agentId: 'assistant', workspacePath: '/workspace', version: '1', loadedAt: 0,
  skills: [{ name: 'find-skills', description: '', enabled: true, availableForCurrentAgent: true, unavailableReason: null }],
};

describe('skill discovery', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    useGatewayStore.setState({ conversationId: 'test-token' });
    vi.mocked(fetchChatAgents).mockResolvedValue({ defaultId: 'assistant', items: [{ id: 'assistant' }] });
    vi.mocked(getChatSkillsCached).mockResolvedValue(available);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useGatewayStore.setState({ conversationId: '' });
  });
  async function renderPage() {
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/skills?q=meeting%20%26%20notes']}>
        <Routes>
          <Route path="/skills" element={<SkillsHarness />} />
          <Route path="/chat/new" element={<Destination />} />
        </Routes>
      </MemoryRouter>,
    ));
  }
  it('opens a fresh default-agent chat with the search draft and no project or automatic send', async () => {
    await renderPage();
    await act(async () => { await vm.onFindSkills(); });
    expect(destination.state).toEqual({ forceNewChat: true, agentId: 'assistant' });
    const params = new URLSearchParams(destination.search);
    expect(params.get('scene')).toBe('find-skills');
    expect(params.get('skill')).toBe('find-skills');
    expect(params.get('projectScope')).toBe('none');
    expect(params.get('draft')).toContain('meeting & notes');
    expect(params.has('autoSend')).toBe(false);
    expect(getChatSkillsCached).toHaveBeenCalledWith('assistant', undefined, true);
  });
  it('coalesces repeated clicks while capability checking is pending', async () => {
    let resolve!: (value: ChatSkillsPayload) => void;
    vi.mocked(getChatSkillsCached).mockReturnValue(new Promise((done) => { resolve = done; }));
    await renderPage();
    let first!: Promise<void>;
    await act(async () => { first = vm.onFindSkills(); await vm.onFindSkills(); });
    expect(vm.findingSkills).toBe(true);
    expect(fetchChatAgents).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(available); await first; });
  });
  it('stays on the skills page with an actionable error when discovery is unavailable', async () => {
    vi.mocked(getChatSkillsCached).mockResolvedValue({ ...available, skills: [] });
    await renderPage();
    await act(async () => { await vm.onFindSkills(); });
    expect(vm.actionFeedback).toEqual({ kind: 'error', message: vm.sk.findUnavailable });
    expect(vm.findingSkills).toBe(false);
  });
  it('only fills the selected example and offers a return link', async () => {
    const onPick = vi.fn();
    const sk = messages('zh').skills;
    await act(async () => root.render(<MemoryRouter><SkillDiscoveryWelcome sk={sk} disabled={false} onPick={onPick} /></MemoryRouter>));
    expect(onPick).not.toHaveBeenCalled();
    act(() => container.querySelector('button')!.click());
    expect(onPick).toHaveBeenCalledExactlyOnceWith(sk.findExamples[0]);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/skills');
  });
});
