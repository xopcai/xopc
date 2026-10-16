// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { messages } from '@/i18n/messages';
import { normalizeVoiceSettings } from '../voice-config-api';
import { VoiceSetup } from '../voice-setup';

vi.mock('swr', () => ({ default: (key: unknown) => ({ data: Array.isArray(key) && key[0] === 'voice-realtime-status'
  ? { enabled: true, tts: { provider:'alibaba', model:'streaming', voice:'Ethan' }, stt: {} }
  : Array.isArray(key) && key[0] === 'realtime-voices' ? [{id:'Ethan',name:'Ethan'},{id:'Cherry',name:'Cherry'}] : undefined }) }));
vi.mock('@/components/ui/popover-select', () => ({ Select: ({children, className: _className, ...props}: any) => <select {...props}>{children}</select>, SelectOption: ({children, ...props}: any) => <option {...props}>{children}</option> }));
let root: ReturnType<typeof createRoot> | undefined; let container: HTMLDivElement;
afterEach(async()=>{await act(async()=>root?.unmount());container.remove();});
it.each(['', 'Cherry'])('changes only assistant output when selecting voice %s', async voice=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const form=normalizeVoiceSettings({voice:{realtime:{enabled:true,defaultEngine:'agent',tts:{provider:'alibaba',voice:'Ethan'},omni:{provider:'alibaba',model:'native',voice:'Serena',instructions:'Keep this'}}}});
  const before=structuredClone(form);const onChange=vi.fn();
  await act(async()=>root!.render(<MemoryRouter><VoiceSetup section="listening" v={messages('en').voiceSettings} form={form} pending={false} onChange={onChange}/></MemoryRouter>));
  const select=container.querySelector<HTMLSelectElement>('#realtime-voice')!;
  await act(async()=>{select.value=voice;select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(onChange).toHaveBeenCalledOnce();
  const next=onChange.mock.calls[0][0];
  expect(next.voice.realtime.tts.voice).toBe(voice || undefined);
  expect(next.voice.realtime.omni).toEqual(before.voice.realtime.omni);
  expect(next.stt).toEqual(before.stt);expect(next.tts).toEqual(before.tts);
  expect(form).toEqual(before);
});

it('shows service default instead of turning a resolved runtime voice into an override', async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const form=normalizeVoiceSettings({voice:{realtime:{enabled:true,defaultEngine:'agent',tts:{provider:'alibaba'}}}});
  await act(async()=>root!.render(<MemoryRouter><VoiceSetup section="listening" v={messages('en').voiceSettings} form={form} pending={false} onChange={vi.fn()}/></MemoryRouter>));
  expect(container.querySelector<HTMLSelectElement>('#realtime-voice')!.value).toBe('');
});
