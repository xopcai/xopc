// @vitest-environment jsdom
import type { SpecialistProfile } from '@xopcai/gateway-contract';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { GatewayAgentRow } from '@/features/settings/types/agent-gateway';
import { messages } from '@/i18n/messages';

const api = vi.hoisted(() => ({ update: vi.fn(), saveFile: vi.fn(), readFile: vi.fn(), listFiles: vi.fn() }));
vi.mock('@/lib/use-media-query', () => ({ useMediaQuery: () => true }));
vi.mock('@/features/settings/agents-admin-api', () => ({
  updateGatewayAgent: api.update, saveAgentProfileFileContent: api.saveFile,
  fetchAgentProfileFiles: api.listFiles, fetchAgentProfileFileContent: api.readFile,
  uploadGatewayAgentAvatar: vi.fn(),
}));
vi.mock('@/features/settings/agents/agent-avatar-field', () => ({ AgentAvatarField: () => <div>Avatar</div> }));
vi.mock('@/features/fs/directory-picker-path-field', () => ({ DirectoryPickerPathField: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <input aria-label="Workspace" value={value} onChange={event => onChange(event.target.value)} /> }));
vi.mock('@/features/settings/agents/agent-model-route-editor', () => ({ ModelRouteEditor: ({ label }: { label: string }) => <div>{label}</div> }));
vi.mock('@/components/block-editor', () => ({ BlockEditor: ({ initialContent, onChange }: { initialContent: string; onChange: (value: string) => void }) => <textarea aria-label="Document" value={initialContent} onChange={event => onChange(event.target.value)} /> }));
vi.mock('@/components/markdown/markdown-editor', () => ({ MarkdownEditor: ({ initialContent, onChange }: { initialContent: string; onChange: (value: string) => void }) => <textarea aria-label="Source" value={initialContent} onChange={event => onChange(event.target.value)} /> }));

import { AgentEditor } from '../agent-editor';
import { SpecialistProfileEditor } from '../specialist-profile-editor';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
let agent: GatewayAgentRow;
const click = async (node: HTMLElement) => { await act(async () => node.click()); };
const tab = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(node => node.textContent === label)!;
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!;
const edit = async (node: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const documentEditor = (title: string) => [...container.querySelectorAll('section')].find(section => section.querySelector('h4')?.textContent === title)!.querySelector<HTMLTextAreaElement>('textarea')!;

beforeEach(async () => {
  vi.clearAllMocks();
  agent = {
    id: 'coder', name: 'Coder', workspace: '/workspace', profileDir: '/profile', isDefault: false,
    override: { id: 'coder', enabled: true, profile: { name: 'Coder', language: 'custom-language' } },
    effective: { id: 'coder', enabled: true, workspace: '/workspace',
      models: { chat: { primary: 'test/model', fallbacks: [] }, intents: {} },
      skills: { mode: 'all-enabled', exclude: [] }, tools: {}, workflows: {}, runtime: {} }, sources: {},
  };
  api.listFiles.mockResolvedValue({ files: ['SOUL.md', 'AGENTS.md', 'TOOLS.md'].map(name => ({ name, missing: false })) });
  api.readFile.mockImplementation(async (_id: string, file: string) => `---\nkeep: true\n---\nOriginal ${file}`);
  api.saveFile.mockResolvedValue(undefined);
  api.update.mockImplementation(async (_id: string, patch: object) => ({ agents: [{ ...agent, override: { ...agent.override, ...patch } }] }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<AgentEditor agent={agent} toolIds={[]} zh messages={messages('zh').agentsSettings}
    onDirtyChange={() => undefined} onClose={() => undefined} onOpenDefaults={() => undefined} onChat={() => undefined} onDelete={() => undefined} />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('groups settings into four outer tabs and links summaries to capability subpanels', async () => {
  expect([...container.querySelectorAll('[role="tab"]')].map(node => node.textContent)).toEqual(['概览', '个性', '能力', '工作设置']);
  await click(button('对话模型test/model继承全局'));
  expect(tab('能力').getAttribute('aria-selected')).toBe('true');
  expect(tab('模型').getAttribute('aria-selected')).toBe('true');
  await click(tab('个性'));
  expect(documentEditor('个性与边界')).not.toBeNull();
  expect(container.querySelector('#agent-panel-profile')?.textContent).not.toContain('擅长的任务');
  expect(api.readFile.mock.calls.map(call => call[1])).toEqual(['SOUL.md']);
  expect(container.querySelector('summary')?.textContent).toContain('更多身份设置');
});

it('retains identity and all three document drafts across tabs and saves each to its own file', async () => {
  await click(tab('个性'));
  const name = container.querySelector<HTMLInputElement>('input[placeholder="例如：小助"]')!;
  await edit(name, 'New name');
  await edit(documentEditor('个性与边界'), 'New personality');
  await click(tab('工作设置'));
  await click(tab('工作规范'));
  await edit(documentEditor('工作规范'), 'New working instructions');
  await click(tab('工具约定'));
  await edit(documentEditor('工具使用约定'), 'New tool guidance');
  await click(tab('能力'));
  await click(tab('个性'));
  expect(name.value).toBe('New name');
  expect(documentEditor('个性与边界').value).toBe('New personality');
  await click(button('保存更改'));
  expect(api.saveFile.mock.calls).toEqual([
    ['coder', 'SOUL.md', '---\nkeep: true\n---\nNew personality'],
    ['coder', 'AGENTS.md', '---\nkeep: true\n---\nNew working instructions'],
    ['coder', 'TOOLS.md', '---\nkeep: true\n---\nNew tool guidance'],
  ]);
  expect(api.update.mock.calls[0][1].profile).toEqual({ name: 'New name', language: 'custom-language' });
});

it('reports partially saved documents and retries only the unsaved file', async () => {
  await click(tab('个性'));
  await edit(documentEditor('个性与边界'), 'Personality draft');
  await click(tab('工作设置'));
  await click(tab('工作规范'));
  await edit(documentEditor('工作规范'), 'Work draft');
  api.saveFile.mockImplementation(async (_id: string, file: string) => { if (file === 'AGENTS.md') throw new Error('Write failed'); });
  await click(button('保存更改'));
  expect(api.update).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('已保存：个性与边界');
  expect(documentEditor('工作规范').value).toBe('Work draft');
  api.saveFile.mockResolvedValue(undefined);
  await click(button('保存更改'));
  expect(api.saveFile.mock.calls.map(call => call[1])).toEqual(['SOUL.md', 'AGENTS.md', 'AGENTS.md']);
  expect(api.update).toHaveBeenCalledOnce();
});

it('allows template replacement to be undone without losing front matter', async () => {
  await click(tab('个性'));
  await click(button('使用模板'));
  await click(button('专业高效'));
  expect(documentEditor('个性与边界').value).toContain('Core Truths');
  await click(button('撤销模板替换'));
  expect(documentEditor('个性与边界').value).toBe('Original SOUL.md');
  expect(button('保存更改').disabled).toBe(true);
});

it('uses localized specialty choices while preserving custom identifiers and hidden matching details', async () => {
  const initial: SpecialistProfile = { version: 1, domains: ['custom-domain'], taskTypes: [], inputKinds: ['custom-input'], outputKinds: ['report'], specialties: ['Existing expertise'], limitations: ['Existing limit'], examples: [{ request: 'Existing request', deliverable: 'Existing result' }] };
  let current = initial;
  function Harness() {
    const [profile, setProfile] = useState<SpecialistProfile | undefined>(initial);
    current = profile!;
    return <SpecialistProfileEditor profile={profile} zh onChange={setProfile} />;
  }
  await act(async () => root.render(<Harness />));
  const software = container.querySelector<HTMLInputElement>('input[value="software"]')!;
  await click(software);
  expect(current.domains).toEqual(['custom-domain', 'software']);
  const bugFix = container.querySelector<HTMLInputElement>('input[value="bug_fix"]')!;
  expect(bugFix.closest('label')?.textContent).toContain('修复 Bug');
  await click(bugFix);
  expect(current.taskTypes).toEqual(['bug_fix']);
  expect(current.inputKinds).toEqual(['custom-input']);
  expect(current.examples).toEqual(initial.examples);
  expect(current.limitations).toEqual(initial.limitations);
  await click(software);
  expect(current.domains).toEqual(['custom-domain']);
});

it('restores each main tab and capability/work subtab scroll position independently', async () => {
  await click(tab('个性'));
  const main = container.querySelector('main')!;
  main.scrollTop = 120;
  await click(tab('能力'));
  expect(main.scrollTop).toBe(0);
  main.scrollTop = 80;
  await click(tab('模型'));
  expect(main.scrollTop).toBe(0);
  main.scrollTop = 240;
  await click(tab('工作设置'));
  expect(main.scrollTop).toBe(0);
  expect(container.querySelector<HTMLElement>('#agent-work-panel-directory')!.hidden).toBe(false);
  main.scrollTop = 40;
  await click(tab('工作规范'));
  expect(main.scrollTop).toBe(0);
  expect(container.querySelector<HTMLElement>('#agent-work-panel-directory')!.hidden).toBe(true);
  main.scrollTop = 160;
  await click(tab('个性'));
  expect(main.scrollTop).toBe(120);
  await click(tab('能力'));
  expect(main.scrollTop).toBe(240);
  await click(tab('擅长的任务'));
  expect(main.scrollTop).toBe(80);
  await click(tab('工作设置'));
  expect(main.scrollTop).toBe(160);
  await click(tab('工作目录'));
  expect(main.scrollTop).toBe(40);
});
