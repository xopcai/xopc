// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const mocks = vi.hoisted(() => ({ responses: new Map<string, unknown>(), patch: vi.fn() }));
vi.mock('swr', () => ({ default: (key: unknown) => ({ data: mocks.responses.get(String(key)), mutate: vi.fn() }), mutate: vi.fn() }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));
vi.mock('../voice-config-api', async original => ({ ...await original<typeof import('../voice-config-api')>(), patchVoiceSettings: mocks.patch }));
vi.mock('../voice-device-settings', () => ({ VoiceDeviceSettings: () => <div data-testid="devices" /> }));
vi.mock('../voice-setup', () => ({ VoiceSetup: ({section}: {section:string}) => <div data-testid={section} /> }));
vi.mock('../platform-voice-settings', () => ({ PlatformVoiceSettings: ({modes}: {modes:string[]}) => <div data-testid="streaming" data-modes={modes.join(',')} /> }));
vi.mock('@/components/ui/popover-select', () => ({ Select: ({children, className: _className, ...props}: any) => <select {...props}>{children}</select>, SelectOption: ({children, ...props}: any) => <option {...props}>{children}</option> }));
import { VoiceSettingsPanel } from '../voice-settings';

let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const v = messages('zh').voiceSettings;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useGatewayStore.setState({ conversationId: 'test-session' }); useLocaleStore.setState({ language: 'zh' });
  mocks.patch.mockReset().mockResolvedValue({});
  mocks.responses.set('/api/config', { payload: { config: { stt: { enabled: true, provider: 'xopc-cloud' }, tts: { enabled: true, provider: 'xopc-cloud', providers: { 'xopc-cloud': { model: 'tts', voice: 'voice-a' } } }, voice: { realtime: { enabled: true, defaultEngine: 'agent' } } } } });
  mocks.responses.set('/api/voice/models', { stt: {}, tts: {}, ttsVoices: {} });
  mocks.responses.set('/api/voice/providers', { providers: [{ id:'xopc-cloud', configured:true, fields:[{key:'model',label:'Model',type:'string'}, {key:'voice',label:'Voice',type:'string'}] }] });
  mocks.responses.set('/api/voice/stt-providers', { providers: [{ id:'xopc-cloud', configured:true, fields:[{key:'model',label:'Model',type:'string'}] }] });
  container = document.createElement('div'); document.body.append(container); root=createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); mocks.responses.clear(); useGatewayStore.setState({conversationId:undefined}); });
const render = (capability: 'transcription'|'speech'|'conversation') => act(async () => root.render(<MemoryRouter><VoiceSettingsPanel capability={capability}/></MemoryRouter>));
it.each(['transcription','speech','conversation'] as const)('opens %s in one scoped editor without navigation or implicit writes', async capability => {
  await render(capability);
  expect(container.querySelector('nav')).toBeNull();
  expect(container.querySelector('#voice-stt-xopc-cloud-model, #voice-tts-xopc-cloud-model')).toBeNull();
  expect(mocks.patch).not.toHaveBeenCalled();
});
it('keeps recognition language, text processing and live dictation together', async () => {
  await render('transcription');
  expect(container.textContent).toContain(v.language.title);
  expect(container.textContent).toContain(v.experience.inputProcessing);
  expect(container.querySelector('[data-testid="streaming"]')?.getAttribute('data-modes')).toBe('transcription.stream');
  expect(container.querySelector('[data-testid="devices"]')).toBeNull();
});
it('keeps readout voice and trigger together without conversation controls', async () => {
  await render('speech');
  expect(container.querySelector('#voice-tts-xopc-cloud-voice')).not.toBeNull();
  expect(container.textContent).toContain(v.setup.readout);
  expect(container.querySelector('[data-testid="listening"]')).toBeNull();
});
it('keeps call behavior, output, devices and diagnostics in the conversation editor', async () => {
  await render('conversation');
  expect(container.querySelector('[data-testid="devices"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="diagnostics"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="streaming"]')?.getAttribute('data-modes')).toBe('speech.stream');
  expect(container.textContent).toContain(v.experience.pace);
});
it('saves text processing through the recognition scope', async () => {
  await render('transcription');
  const select = [...container.querySelectorAll('select')].find(element => element.closest('label')?.textContent?.includes(v.stt.refinement))!;
  expect(select).toBeDefined();
  await act(async () => { select.value = 'punctuation'; select.dispatchEvent(new Event('change', {bubbles:true})); });
  await act(async () => { select.dispatchEvent(new FocusEvent('focusout', {bubbles:true})); });
  await act(async () => new Promise(resolve => setTimeout(resolve, 600)));
  expect(mocks.patch).toHaveBeenCalled();
  expect(mocks.patch.mock.calls[0][0].voice.input.refinement.mode).toBe('punctuation');
  expect(mocks.patch.mock.calls[0][1]).toBe('transcription');
});
