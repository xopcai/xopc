import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { AliyunPhoneForm } from './aliyun-phone-form';
import { WirelessPhoneForm } from './wireless-phone-form';
import { PhoneDependenciesCard } from '../runtime-tools/phone-dependencies-card';
import { HdcConnectionTools } from './hdc-connection-tools';
import { phoneRequest, fetchPhoneDevices, type PhoneDevices } from './phone-api';
import { phoneConnectionMethods, type PhoneConnectionMethod } from './phone-connection-methods';

type DiscoveredDevice = PhoneDevices['discovery'][number];
export function AddPhoneDialog({ zh, onClose, onSelect, onAdded, initialMethod }: {
  zh: boolean; initialMethod?: PhoneConnectionMethod; onClose(): void; onSelect(device: DiscoveredDevice): void; onAdded?(): void;
}) {
  const [method, setMethod] = useState<PhoneConnectionMethod | undefined>(initialMethod);
  const harmony = method === 'local-hdc';
  const devices = useSWR(method === 'local-adb' ? 'phone-devices' : harmony ? 'phone-devices-harmonyos' : null,
    () => harmony ? phoneRequest<PhoneDevices>('/devices?platform=harmonyos') : fetchPhoneDevices(), { refreshInterval: 3000 });
  const selected = phoneConnectionMethods.find(item => item.id === method);
  const index = zh ? 0 : 1;
  const states: Record<string, string> = zh ? { device: '已连接，可添加', unauthorized: '等待手机授权：解锁手机，点击「允许 USB 调试」', offline: '设备离线：重新连接数据线或无线调试', recovery: '恢复模式：请先启动 Android 系统', sideload: '请退出刷机模式并启动 Android 系统' } : { device: 'Connected · Ready to add', unauthorized: 'Unlock the phone and allow USB debugging', offline: 'Offline · Reconnect USB or wireless debugging', recovery: 'Boot Android before connecting', sideload: 'Exit sideload mode and boot Android' };
  const discovered = (devices.data?.discovery ?? []).filter(device => (device.platform === 'harmonyos') === harmony);
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] flex h-[min(42rem,90dvh)] w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay text-fg">
      <header className="flex shrink-0 items-start gap-3 border-b border-edge p-5">
        {method && <Button variant="ghost" aria-label={zh ? '返回连接方式' : 'Back to connection methods'} onClick={() => setMethod(undefined)}><ArrowLeft className="size-4" /></Button>}
        <div className="min-w-0 flex-1"><Dialog.Title className="text-base font-semibold">{zh ? '添加手机' : 'Add phone'}</Dialog.Title><Dialog.Description className="mt-1 text-sm text-fg-muted">{selected ? selected.name[index] : zh ? '选择手机连接在哪里。手机模型在添加设备后独立配置。' : 'Choose where the phone connects. Phone models are configured separately.'}</Dialog.Description></div>
        <Dialog.Close asChild><Button variant="ghost" aria-label={zh ? '关闭添加手机' : 'Close add phone'}><X className="size-4" /></Button></Dialog.Close>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {!method ? phoneConnectionMethods.map(item => <button key={item.id} className="block min-h-20 w-full rounded-xl border border-edge bg-surface-base p-4 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent" onClick={() => setMethod(item.id)}><span className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">{item.name[index]}{!item.available && <span className="text-xs font-normal text-fg-muted">{zh ? '暂未支持' : 'Not available yet'}</span>}</span><span className="mt-2 block text-xs text-fg-muted">{item.description[index]}</span></button>) : method === 'aliyun' ? <AliyunPhoneForm zh={zh} onAdded={() => { onAdded?.(); onClose(); }} /> : method === 'wireless' ? <WirelessPhoneForm zh={zh} onSelect={onSelect} /> : method !== 'local-adb' && !harmony ? <div className="space-y-4 rounded-xl border border-edge bg-surface-base p-4"><h3 className="text-sm font-medium">{zh ? '此接入方式暂未支持' : 'This connection method is not available yet'}</h3><p className="text-sm text-fg-muted">{method === 'remote-connector' ? (zh ? '后续可通过本地连接器将电脑上的手机接入远程 Gateway。当前请将手机连接到 Gateway 所在电脑。' : 'A future local connector will connect your phone to a remote Gateway. For now, connect it to the Gateway host.') : (zh ? '云手机适配器接入后，可配置云账号、选择地域和已有实例，再验证连接并添加。当前尚不能连接云实例，不会要求填写云密钥。' : 'Once the cloud adapter is available, connect an account, select a region and existing instance, then verify and add it. Cloud connections are not supported yet.')}</p><p className="text-xs text-fg-muted">{zh ? '添加已有实例与购买、创建、销毁实例分开处理。' : 'Adding existing instances is separate from purchasing, creating or destroying them.'}</p></div> : <>
          <p className="rounded-xl bg-surface-inset p-3 text-sm">{zh ? '连接位置：Gateway 所在电脑。若 Gateway 在服务器上，浏览器无法访问你电脑的 USB 手机。' : 'Connection location: the Gateway host. A remote Gateway cannot access your browser computer’s USB phone.'}</p>
          {harmony && <PhoneDependenciesCard initialPlatform="harmonyos" onChanged={() => { void devices.mutate(); }} />}
          {harmony && <HdcConnectionTools zh={zh} onSaved={() => { void devices.mutate(); }} />}
          {harmony && <p className="text-sm text-fg-muted">{zh ? '通过 USB 连接，自动使用实时投屏，失败时回退到截图。手势释放后执行，文字请在手机上输入。' : 'USB connection with live video and snapshot fallback. Gestures execute on release; enter text on the phone.'}</p>}
          <ol className="list-decimal space-y-2 pl-5 text-sm text-fg-muted"><li>{zh ? (harmony ? '鸿蒙手机开启开发者模式和 USB 调试。' : '手机开启开发者选项和 USB 调试；模拟器直接启动即可。') : (harmony ? 'Enable developer mode and USB debugging on your HarmonyOS phone.' : 'Enable developer options and USB debugging, or start an emulator.')}</li><li>{zh ? '用数据线连接 Gateway 电脑，在手机上允许 USB 调试。' : 'Connect to the Gateway host with a data cable, then allow USB debugging on the phone.'}</li><li>{zh ? '等待下方显示设备，选择后确认名称和应用范围。' : 'Select a discovered device below, then confirm its name and app access.'}</li></ol>
          {!harmony && <details className="text-sm"><summary className="cursor-pointer text-fg-muted">{zh ? '使用无线连接或安装连接工具' : 'Wireless connection or connection tools'}</summary><p className="mt-2 text-xs leading-relaxed text-fg-muted">{zh ? '可返回连接方式，选择「无线连接 Android 手机」进行扫码或配对码配对。ADB 可在手机控制页的「手机依赖状态」中手动安装，或使用 Gateway 电脑上已有的 Platform Tools；无需安装完整 Android Studio。' : 'Choose Wireless Android phone to pair with a QR code or pairing code. Install ADB from Phone dependencies or use existing Platform Tools on the Gateway host.'}</p><a href="https://developer.android.com/tools/adb" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-accent-fg hover:underline">{zh ? '查看 Android 官方连接指引' : 'Android connection guide'}</a></details>}
          <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{zh ? '发现的设备' : 'Discovered devices'}</h3><Button disabled={devices.isValidating} onClick={() => { void devices.mutate(); }}><RefreshCw className="size-4" />{zh ? '刷新' : 'Refresh'}</Button></div>
          {!devices.data && !devices.error ? <Skeleton className="h-24 w-full rounded-xl" /> : null}
          {(devices.error || devices.data?.diagnostic) && <p role="alert" className="text-sm text-danger">{zh ? (harmony ? '无法检测设备，请检查 Gateway 电脑的 HDC 路径、USB 连接和手机授权。' : '无法检测设备，请检查 Gateway 电脑的 ADB 安装与连接。') : (harmony ? 'Unable to detect devices. Check HDC, USB and phone authorization on the Gateway host.' : 'Unable to detect devices. Check ADB on the Gateway host.')}<span className="mt-1 block break-all text-xs">{devices.data?.diagnostic ?? String(devices.error)}</span></p>}
          {discovered.map(device => {
            const registered = devices.data?.devices.some(item => item.serial === device.serial && (item.platform ?? 'android') === (device.platform ?? 'android'));
            return <div key={`${device.platform ?? 'android'}:${device.serial}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge p-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{device.name}</p><p className="mt-1 break-all text-xs text-fg-muted">{device.serial}</p><p className="mt-1 text-xs text-fg-muted">{states[device.state] ?? device.state}</p></div><Button disabled={registered || device.state !== 'device'} onClick={() => onSelect(device)}>{registered ? (zh ? '已添加' : 'Added') : (zh ? '选择设备' : 'Choose device')}</Button></div>;
          })}
          {devices.data && !discovered.length && <p role="status" className="text-sm text-fg-muted">{zh ? '尚未发现设备。请检查数据线、手机调试授权，或启动模拟器。' : 'No devices found. Check the cable and debugging authorization, or start an emulator.'}</p>}
        </>}
      </div>
      <footer className="flex shrink-0 justify-end border-t border-edge p-4"><Dialog.Close asChild><Button>{zh ? '取消' : 'Cancel'}</Button></Dialog.Close></footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
