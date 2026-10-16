// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, expect, it, vi } from 'vitest';
import type { ModelSetupPreview } from '@xopcai/gateway-contract';

const api = vi.hoisted(() => ({ fetch: vi.fn(), stt: vi.fn(), tts: vi.fn(), dialog: vi.fn() }));
vi.mock('../provider-setup-api', () => ({ fetchModelSetup: api.fetch }));
vi.mock('@/features/settings/voice-config-api', () => ({ fetchVoiceSttProviders: api.stt, fetchVoiceProviders: api.tts }));
vi.mock('../add-provider-dialog', () => ({ AddProviderDialog: (props: unknown) => { api.dialog(props); return <div>credentials only</div>; } }));
import { CapabilityServiceConnections, eligibleCapabilityServices } from '../capability-service-connections';
import type { ConnectedProvidersData } from '../connected-providers-grid';
import type { AddProviderDialogMessages } from '../add-provider-dialog';

const preview = (id: string, uses: string[]): ModelSetupPreview => ({
  providerId: id, configured: true, profile: { id, name: id, brand: id, access: 'api', credential: 'api-key', interactiveOnly: false },
  revision: 'r', mode: 'fill', taskModels: {}, uses: uses.map(id => ({ id, choices: [{ id: 'model', name: 'model' }], selected: false })),
} as ModelSetupPreview);
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); container?.remove(); vi.clearAllMocks(); });
it('discovers future plans from capabilities and keeps background restrictions authoritative', () => {
  const sources = [preview('future-plan', ['speech']), preview('text-only', ['chat']), preview('cloud', ['background']), preview('openai', ['speech'])];
  expect(eligibleCapabilityServices(sources, 'speech', ['openai']).map(source => source.providerId)).toEqual(['future-plan']);
  expect(eligibleCapabilityServices(sources, 'background').map(source => source.providerId)).toEqual(['cloud']);
});
it.each([['transcription', 'stt'], ['speech', 'tts']] as const)('isolates %s services and opens only scoped credential setup', async (use, kind) => {
  api.stt.mockResolvedValue({ providers: [{ id: 'openai', diagnostics: { requiresApiKey: true } }, { id: 'future-plan', diagnostics: { requiresApiKey: false } }] }); api.tts.mockResolvedValue({ providers: [{ id: 'openai', diagnostics: { requiresApiKey: true } }, { id: 'future-plan', diagnostics: { requiresApiKey: false } }] });
  api.fetch.mockImplementation(async (id: string) => preview(id, id === 'text-only' ? ['chat'] : [use]));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const data = { loading: false, cards: [], builtinRows: ['future-plan', 'openai', 'text-only'].map(id => ({ id })), customConfig: null, allModels: [] } as unknown as ConnectedProvidersData;
  await act(async () => root!.render(<SWRConfig value={{ provider: () => new Map() }}><CapabilityServiceConnections use={use} data={data} language="zh" labels={{} as AddProviderDialogMessages} onSaved={() => {}} /></SWRConfig>));
  expect(kind === 'stt' ? api.stt : api.tts).toHaveBeenCalledOnce();
  expect(kind === 'stt' ? api.tts : api.stt).not.toHaveBeenCalled();
  expect(api.fetch.mock.calls.map(([id]) => id)).not.toContain('openai');
  expect(container.textContent).not.toContain('text-only');
  const button = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('future-plan'))!;
  await act(async () => button.click());
  expect(api.dialog).toHaveBeenLastCalledWith(expect.objectContaining({ initialUse: use, initialProviderId: 'future-plan', connectOnly: true, builtinRows: [{ id: 'future-plan' }] }));
});
