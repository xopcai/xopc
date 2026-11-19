import * as Dialog from '@radix-ui/react-dialog';
import { CalendarDays, CheckCircle2, ChevronRight, Clock3, Contact, Folder, Image, Laptop, Loader2, MapPin, Monitor, MousePointer2, Plus, ShieldCheck, Smartphone, WifiOff, type LucideIcon } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import { DEVICE_FOLDER_PRESETS, type DeviceConnection, type DeviceConnections, type DeviceFolderGrant, type DeviceFolderKind, type MobileDeviceChatTool } from '@xopcai/endpoint-tools-protocol';

import { Button } from '@/components/ui/button';
import { SlidingTabList } from '@/components/ui/sliding-tab-list';
import { CONNECTION_CARD_GRID_CLASS, CONNECTION_CARD_SURFACE_CLASS } from '@/features/connectors/components/connection-summary-card';
import { InstalledConnectorRowSkeleton } from '@/features/connectors/components/installed-connector-row-skeleton';
import { cn } from '@/lib/cn';
import { fetchJson } from '@/lib/fetch';
import { interaction } from '@/lib/interaction';
import { useSectionNavigation } from '@/lib/use-section-navigation';
import { apiUrl } from '@/lib/url';
import { DevicePairingAction } from './device-pairing-action';

type FolderEditor = { kind: DeviceFolderKind; folder?: DeviceFolderGrant };
type LocalizedText = readonly [zh: string, en: string];
const DEVICE_CONNECTIONS_PATH = '/api/endpoint-tools/device-connections';
const mobileTools = [
  ['mobile.file.pick', Folder, ['阅读文件', 'Read a file'], ['从手机上选择一个文件，请助理阅读或总结。', 'Select a file on your phone to read or summarize.'],
    ['请让我在选中的手机上选择一个文件，帮我阅读并总结内容。', 'Let me pick a file on the selected phone, then read and summarize it.']],
  ['mobile.media.pick', Image, ['解读照片', 'Analyze a photo'], ['从相册选一张照片，了解画面里的内容。', 'Choose a photo from your library and ask about what’s in it.'],
    ['请让我在选中的手机上从相册选择一张照片，然后帮我解读。', 'Let me pick a photo on the selected phone, then describe what’s in it.']],
  ['mobile.contacts.pick', Contact, ['选取联系方式', 'Pick contact details'], ['从手机通讯录选择一个电话号码。', 'Pick a phone number from your phone’s contacts.'],
    ['请让我从选中的手机通讯录里选择一个联系人的电话号码。', 'Let me pick a contact’s phone number on the selected phone.']],
  ['mobile.calendar.query_events', CalendarDays, ['查看日程', 'Check your schedule'], ['查看手机上今天的日程。', 'See today’s events on your phone.'],
    ['请查看选中的手机日历，告诉我今天有哪些安排。', 'Check the calendar on the selected phone and tell me what’s scheduled today.']],
  ['mobile.device.get_location', MapPin, ['使用当前位置', 'Use your location'], ['用手机的大致位置查询当地天气。', 'Check local weather using your phone’s approximate location.'],
    ['请用选中手机的大致位置查询当地天气。', 'Use the selected phone’s approximate location to check the local weather.']],
] as const satisfies ReadonlyArray<readonly [MobileDeviceChatTool, LucideIcon, LocalizedText, LocalizedText, LocalizedText]>;
const names = { desktop: ['桌面', 'Desktop'], documents: ['文稿', 'Documents'], downloads: ['下载', 'Downloads'] } as const;

const platformNames: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux', ios: 'iOS', android: 'Android', harmonyos: 'HarmonyOS' };
const platformIconTones: Record<string, string> = {
  harmonyos: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  ios: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  android: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  darwin: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
  win32: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
};

function DeviceIcon({ device }: { device: DeviceConnection }) {
  const Icon = device.kind === 'mobile' ? Smartphone : device.platform === 'darwin' ? Laptop : Monitor;
  return <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', platformIconTones[device.platform] ?? 'bg-surface-inset text-fg-muted')}>
    <Icon className="size-[1.125rem]" strokeWidth={1.75} aria-hidden />
  </span>;
}

function DeviceStatus({ device, zh, local }: { device: DeviceConnection; zh: boolean; local: boolean }) {
  const offline = device.availability === 'offline';
  const needsForeground = device.kind === 'mobile' && device.availability === 'background';
  const Icon = offline ? WifiOff : needsForeground ? Clock3 : CheckCircle2;
  return <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-fg-muted">
    <span className={cn('inline-flex items-center gap-1', needsForeground ? 'text-amber-700 dark:text-amber-300'
      : !offline && 'text-emerald-700 dark:text-emerald-300')}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {offline ? (zh ? '离线' : 'Offline') : needsForeground ? (zh ? '待打开 xopc' : 'Open xopc to use') : (zh ? '在线' : 'Online')}
    </span>
    <span>{platformNames[device.platform] ?? device.platform}</span>
    {local ? <span>{zh ? '本机' : 'This computer'}</span> : null}
  </span>;
}

const capabilityActionClass = '-mr-2 gap-1 px-2 text-xs text-accent-fg hover:text-accent-fg';

function DeviceCapabilityCard({ icon: Icon, name, description, action }: {
  icon: LucideIcon; name: string; description: string; action?: ReactNode;
}) {
  return <article className={CONNECTION_CARD_SURFACE_CLASS}>
    <div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-inset text-fg-muted">
        <Icon className="size-[1.125rem]" strokeWidth={1.75} aria-hidden />
      </span>
      <h3 className="min-w-0 text-sm font-semibold text-fg [overflow-wrap:anywhere]">{name}</h3>
    </div>
    <p className="mt-2 text-xs leading-5 text-fg-muted [overflow-wrap:anywhere]">{description}</p>
    {action ? <div className="mt-auto flex justify-end pt-1">{action}</div> : null}
  </article>;
}

function DeviceSections({ devices, localId, zh, renderCapabilities }: {
  devices: DeviceConnection[]; localId?: string; zh: boolean;
  renderCapabilities: (device: DeviceConnection) => ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const headingPrefix = useId();
  const first = devices[0].id;
  const { active, jumpTo } = useSectionNavigation({
    contentRef, toolbarRef, navRef, sectionAttribute: 'data-device-section', initialSectionId: first,
    alignLastSection: devices.length > 1,
  });
  const current = devices.some(device => device.id === active) ? active : first;

  return <div ref={contentRef} className="min-w-0">
    <div ref={toolbarRef} className="sticky top-0 z-10 bg-surface-base pt-3 pb-3 lg:pt-4">
      <SlidingTabList as="nav" ref={navRef} aria-label={zh ? '设备导航' : 'Device navigation'}
        scrollFocusedItemIntoView={false} className="flex w-full gap-1 overflow-x-auto overscroll-x-contain rounded-xl bg-surface-inset/70 p-1"
        indicatorClassName="rounded-lg bg-surface-panel ring-1 ring-edge-subtle">
        {devices.map(device => <button key={device.id} type="button"
          className={cn('relative z-[1] flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-hover/60', interaction.transition,
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent')}
          aria-current={current === device.id ? 'location' : undefined}
          aria-pressed={current === device.id}
          aria-controls={`${headingPrefix}-section-${device.id}`}
          onClick={() => jumpTo(device.id)}>
          <DeviceIcon device={device} />
          <span className="block min-w-0 max-w-48">
            <span className="block truncate text-sm font-medium text-fg" title={device.name}>{device.name}</span>
            <DeviceStatus device={device} zh={zh} local={device.id === localId} />
          </span>
        </button>)}
      </SlidingTabList>
    </div>
    <div className="space-y-7">
      {devices.map(device => {
        const sectionId = `${headingPrefix}-section-${device.id}`;
        return <section key={device.id} id={sectionId} aria-labelledby={`${sectionId}-heading`}
          data-device-section={device.id} className="space-y-3 scroll-mt-20 last:min-h-[var(--section-scroll-tail-height,0px)]">
          <h2 id={`${sectionId}-heading`} className="text-sm font-semibold text-fg [overflow-wrap:anywhere]">{device.name}</h2>
          {renderCapabilities(device)}
        </section>;
      })}
    </div>
  </div>;
}

export function ConnectDeviceButton({ zh }: { zh: boolean }) {
  const { mutate } = useSWRConfig();
  return <DevicePairingAction label={zh ? '连接设备' : 'Connect a device'} onPaired={() => void mutate(apiUrl(DEVICE_CONNECTIONS_PATH))} />;
}

export function DeviceConnectionsPanel({ zh }: { zh: boolean }) {
  const navigate = useNavigate();
  const desktop = window.electronAPI?.deviceFolders;
  const catalog = useSWR(apiUrl(DEVICE_CONNECTIONS_PATH), async url => (
    await fetchJson<{ payload: DeviceConnections }>(url)
  ).payload, { refreshInterval: 5_000, shouldRetryOnError: false });
  const local = useSWR(desktop ? 'device-folders:status' : null, () => desktop?.status(), { refreshInterval: 3_000 });
  const [editor, setEditor] = useState<FolderEditor>();
  const [mobileIds, setMobileIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [startingTool, setStartingTool] = useState<{ deviceId: string; tool: MobileDeviceChatTool }>();
  const [chatError, setChatError] = useState<{ deviceId: string; message: string }>();
  const folderTrigger = useRef<HTMLButtonElement>(null);
  const folderFallback = useRef<HTMLButtonElement>(null);
  const devices = catalog.data?.devices ?? [];
  const localDevice = devices.find(device => device.endpointId && device.endpointId === local.data?.endpointId);
  const mobile = devices.filter(device => device.kind === 'mobile');
  const locale = zh ? 0 : 1;
  const offlineHint = zh ? '让设备连上网络，再打开 xopc。' : 'Connect the device to the internet, then open xopc.';
  const folderName = (kind: DeviceFolderKind, label?: string) => kind === 'custom' ? (label ?? (zh ? '文件夹' : 'Folder')) : names[kind][locale];

  async function startChat(device: DeviceConnection, toolName: MobileDeviceChatTool, prompt: string) {
    if (startingTool || device.kind !== 'mobile' || device.availability !== 'foreground' || !device.endpointId) return;
    setStartingTool({ deviceId: device.id, tool: toolName });
    setChatError(undefined);
    try {
      const { payload } = await fetchJson<{ payload: { conversationId: string } }>(apiUrl(`${DEVICE_CONNECTIONS_PATH}/chat`), {
        method: 'POST', body: JSON.stringify({ endpointId: device.endpointId, toolName }),
      });
      const query = new URLSearchParams({ draft: prompt, autoSend: '1' });
      navigate(`/chat/${encodeURIComponent(payload.conversationId)}?${query}`);
    } catch (error) {
      const unavailable = typeof error === 'object' && error !== null && 'status' in error && error.status === 409;
      setChatError({ deviceId: device.id, message: unavailable
        ? (zh ? '手机暂时无法使用此项功能，请打开手机上的 xopc 后重试。' : 'This feature is unavailable. Open xopc on the phone and try again.')
        : (zh ? '暂时无法开启新对话，请重试。' : 'Unable to start a new chat. Try again.') });
      if (unavailable) void catalog.mutate().catch(() => {});
    } finally {
      setStartingTool(undefined);
    }
  }

  function configure(kind: DeviceFolderKind, trigger: HTMLButtonElement, folder?: DeviceFolderGrant) {
    folderTrigger.current = trigger;
    setFailed(false);
    setMobileIds(folder?.mobileIds.filter(id => mobile.some(device => device.id === id)) ?? []);
    setEditor({ kind, folder });
  }

  async function save(revoke = false) {
    if (!editor || !desktop || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const id = editor.folder?.id;
      if (revoke && id) {
        await desktop.change({ id, revoke: true });
        if (editor.kind === 'custom') folderTrigger.current = null;
      } else if (id) await desktop.change({ id, mobileIds });
      else await desktop.change({ kind: editor.kind, mobileIds });
      setEditor(undefined);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      await Promise.all([local.mutate(), catalog.mutate()]);
    }
  }

  function renderPhoneCapabilities(device: DeviceConnection) {
    const actions = mobileTools.filter(([id]) => device.tools.includes(id));
    if (actions.length === 0) return <p className="rounded-xl bg-surface-panel p-4 text-sm text-fg-muted">
      {zh ? '这部手机暂时没有可在对话中使用的功能。' : 'This phone has no features available for chats yet.'}
    </p>;
    return <div className="space-y-3">
      {device.availability === 'background' ? <p className="text-sm text-fg-muted">
        {zh ? '在手机上打开 xopc 后，即可从这里使用。' : 'Open xopc on your phone to use these features.'}
      </p> : null}
      {chatError?.deviceId === device.id ? <p role="alert" className="text-sm text-danger">{chatError.message}</p> : null}
      <div className={CONNECTION_CARD_GRID_CLASS}>
        {actions.map(([id, Icon, title, description, prompt]) => <DeviceCapabilityCard
          key={id} icon={Icon} name={title[locale]} description={description[locale]}
          action={device.endpointId ? <Button variant="ghost" className={capabilityActionClass}
            disabled={Boolean(startingTool) || device.availability !== 'foreground'}
            aria-label={zh ? `在新对话中使用「${title[locale]}」` : `Use ${title[locale]} in a new chat`}
            onClick={() => void startChat(device, id, prompt[locale])}>
            {zh ? '新对话中使用' : 'Use in new chat'}
            {startingTool?.deviceId === device.id && startingTool.tool === id
              ? <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
              : <ChevronRight className="size-3.5" aria-hidden />}
          </Button> : null}
        />)}
      </div>
    </div>;
  }

  function renderComputerCapabilities(device: DeviceConnection) {
    const isLocal = device.id === localDevice?.id;
    const canManage = isLocal && local.data?.ready;
    const grants = isLocal ? local.data?.folders ?? [] : [];
    const folders = isLocal ? grants : device.folders;
    const folderRows = [
      ...DEVICE_FOLDER_PRESETS.map(kind => ({ kind, folder: folders.find(row => row.kind === kind) })),
      ...folders.filter(folder => folder.kind === 'custom').map(folder => ({ kind: folder.kind, folder })),
    ];

    return <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-muted">
          {zh ? '在对话中查找并阅读已授权文件夹里的文件。' : 'Find and read files from approved folders in your chats.'}
        </p>
        {canManage ? <Button ref={folderFallback} variant="secondary" className="shrink-0 text-xs" onClick={event => configure('custom', event.currentTarget)}>
          <Plus className="size-4" aria-hidden />{zh ? '添加文件夹' : 'Add folder'}
        </Button> : null}
      </div>
      <div className={CONNECTION_CARD_GRID_CLASS}>
        {folderRows.map(({ kind, folder }) => {
          const grant = grants.find(entry => entry.id === folder?.id);
          const audience = mobile.filter(device => grant?.mobileIds.includes(device.id)).map(device => device.name);
          const access = !folder ? (zh ? '未开放访问' : 'Access off') : zh
            ? (audience.length ? `这台电脑、${audience.join('、')} · 只读` : isLocal ? '仅这台电脑 · 只读' : '只读')
            : (audience.length ? `This computer and ${audience.join(', ')} · Read only` : isLocal ? 'This computer only · Read only' : 'Read only');
          const name = folderName(kind, folder?.label);
          const action = folder ? (zh ? '管理' : 'Manage') : (zh ? '允许访问' : 'Allow access');
          return <DeviceCapabilityCard key={kind === 'custom' ? folder?.id : kind} icon={Folder} name={name} description={access}
            action={canManage ? <Button variant="ghost" className={capabilityActionClass} aria-label={`${action} ${name}`}
              onClick={event => configure(kind, event.currentTarget, grant)}>
              {action}<ChevronRight className="size-3.5" aria-hidden />
            </Button> : null}
          />;
        })}
        {isLocal && (device.platform === 'darwin' || device.platform === 'win32') ? <DeviceCapabilityCard
          icon={MousePointer2} name={zh ? '操作应用窗口' : 'Operate application windows'}
          description={zh ? '在设置中管理应用窗口操作权限。' : 'Manage access to application windows in settings.'}
          action={<Button asChild variant="ghost" className={capabilityActionClass}>
            <Link to="/settings/computer-use">{zh ? '设置' : 'Settings'}<ChevronRight className="size-3.5" aria-hidden /></Link>
          </Button>}
        /> : null}
      </div>
      <p className="flex gap-2 text-xs leading-5 text-fg-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        {isLocal ? (zh ? '可随时撤销授权。选中文件的内容可能随对话发送给模型。' : 'You can revoke access at any time. Selected file content can be sent to your model.')
          : (zh ? '请在文件所在的电脑上更改访问设置。' : 'Change access on the computer where the files are stored.')}
      </p>
    </div>;
  }

  const orderedDevices = localDevice ? [localDevice, ...devices.filter(device => device.id !== localDevice.id)] : devices;

  return <>
    {catalog.isLoading || local.isLoading ? <div aria-busy="true" aria-label={zh ? '正在加载设备' : 'Loading devices'} className={cn(CONNECTION_CARD_GRID_CLASS, 'pt-3 lg:pt-4')}>
      {[0, 1, 2].map(slot => <InstalledConnectorRowSkeleton key={slot} />)}
    </div> : catalog.error ? <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-edge bg-surface-panel p-4 text-sm text-fg-muted lg:mt-4">
      <p>{zh ? '暂时无法加载设备，请检查连接后重试。' : 'Unable to load devices. Check your connection and try again.'}</p>
      <Button variant="secondary" onClick={() => void catalog.mutate()}>{zh ? '重试' : 'Retry'}</Button>
    </div> : !devices.length ? <p className="mt-3 py-14 text-center text-sm text-fg-muted lg:mt-4">
      {zh ? '在电脑上打开 xopc，或点击「连接设备」添加手机。' : 'Open xopc on your computer, or select Connect a device to add your phone.'}
    </p> : <DeviceSections devices={orderedDevices} localId={localDevice?.id} zh={zh} renderCapabilities={device => (
      device.availability === 'offline' ? <p className="flex items-center gap-3 rounded-xl bg-surface-panel p-4 text-sm text-fg-muted">
        <WifiOff className="size-4 shrink-0" aria-hidden />{offlineHint}
      </p> : device.kind === 'desktop' ? renderComputerCapabilities(device) : renderPhoneCapabilities(device)
    )} />}
    <Dialog.Root open={Boolean(editor)} onOpenChange={open => { if (!open && !busy) setEditor(undefined); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
        <Dialog.Content
          className="xopc-dialog-content fixed left-1/2 top-1/2 z-[60] flex h-[min(28rem,calc(100dvh-2rem))] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-float outline-none"
          onCloseAutoFocus={event => {
            event.preventDefault();
            (folderTrigger.current?.isConnected ? folderTrigger.current : folderFallback.current)?.focus();
          }}
        >
          <header className="border-b border-edge-subtle px-5 py-4">
            <Dialog.Title className="font-semibold text-fg">{editor?.folder ? (zh ? '管理文件夹访问' : 'Manage folder access') : (zh ? '允许访问文件夹' : 'Allow folder access')}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-fg-muted">
              {editor ? folderName(editor.kind, editor.folder?.label) : ''} · {zh ? '只读' : 'Read-only'}
            </Dialog.Description>
          </header>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 text-sm text-fg">
            <p>{mobile.length > 0
              ? (zh ? '这台电脑可以读取此文件夹。也可以选择哪些手机能在对话中使用它。' : 'This computer can read this folder. You can also choose which phones can use it in chats.')
              : (zh ? '这台电脑可以在对话中读取此文件夹。' : 'This computer can read this folder in chats.')}</p>
            {mobile.length > 0 ? <div className="divide-y divide-edge-subtle rounded-xl bg-surface-inset/60 px-3">
              {mobile.map(device => <label key={device.id} className="flex min-h-11 items-center gap-3 py-2 [overflow-wrap:anywhere]">
                <input type="checkbox" className="size-4 shrink-0 accent-accent" checked={mobileIds.includes(device.id)} disabled={busy}
                  onChange={event => setMobileIds(ids => event.target.checked ? [...ids, device.id] : ids.filter(id => id !== device.id))} />{device.name}
              </label>)}
            </div> : null}
            {failed ? <p role="alert" className="text-sm text-danger">{zh ? '无法更新文件夹访问设置，请检查设备连接并重试。' : 'Unable to update folder access. Check the device connection and try again.'}</p> : null}
          </div>
          <footer className="flex flex-wrap justify-end gap-2 border-t border-edge-subtle p-4">
            {editor?.folder ? <Button variant="secondary" disabled={busy} onClick={() => void save(true)}>{zh ? '撤销授权' : 'Revoke'}</Button> : null}
            <Button variant="secondary" disabled={busy} onClick={() => setEditor(undefined)}>{zh ? '取消' : 'Cancel'}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>{editor?.folder ? (zh ? '保存' : 'Save') : (zh ? '选择文件夹' : 'Choose folder')}</Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
