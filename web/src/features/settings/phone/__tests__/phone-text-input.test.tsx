// @vitest-environment jsdom
import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../phone-api',()=>({phoneRequest:vi.fn()}));
import {phoneRequest} from '../phone-api';
import {PhoneTextInput} from '../phone-text-input';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let node:HTMLDivElement;let root:ReturnType<typeof createRoot>;
beforeEach(()=>{node=document.createElement('div');document.body.append(node);root=createRoot(node);vi.clearAllMocks();});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();});
function Harness(){const [value,setValue]=useState<'auto'|'manual'>('auto');return <PhoneTextInput deviceId="phone" value={value} onChange={setValue} disabled={false} zh/>;}
it('allows personal phones to use only their own keyboard without installing anything',async()=>{
 await act(async()=>root.render(<Harness/>));expect(node.textContent).toContain('不安装或切换输入法');expect(phoneRequest).not.toHaveBeenCalled();
 await act(async()=>(node.querySelector('input') as HTMLInputElement).click());expect(node.textContent).toContain('使用手机自带键盘输入');expect(phoneRequest).not.toHaveBeenCalled();
});
it.each(['available','setup_required','unsupported'])('explains %s diagnostics without changing phone state',async unicode=>{
 vi.mocked(phoneRequest).mockResolvedValue({unicode});await act(async()=>root.render(<Harness/>));
 await act(async()=>(node.querySelector('button') as HTMLButtonElement).click());
 expect(phoneRequest).toHaveBeenCalledExactlyOnceWith('/devices/phone/input-status');
 expect(node.querySelector('[role="status"]')?.textContent).toContain(unicode==='available'?'已就绪':unicode==='setup_required'?'修复 scrcpy':'手机自带键盘');
});
it('keeps detection failure retryable without instructing users to install an APK',async()=>{
 vi.mocked(phoneRequest).mockRejectedValue(new Error('offline'));await act(async()=>root.render(<Harness/>));await act(async()=>(node.querySelector('button') as HTMLButtonElement).click());
 expect(node.querySelector('[role="status"]')?.textContent).toContain('暂时无法检测');expect((node.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
});
