import * as Dialog from '@radix-ui/react-dialog';
import { Battery, Bell, CalendarDays, Camera, CheckCircle2, ChevronRight, Clipboard, Clock3, Contact, FileText, Folder, Image, Laptop, Link2, Loader2, MapPin, Monitor, MousePointer2, Plus, ShieldCheck, Smartphone, WifiOff, type LucideIcon } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import { DEVICE_FOLDER_PRESETS, type DesktopDeviceChatTool, type DeviceChatTool, type DeviceConnection, type DeviceConnections, type DeviceFolderChange, type DeviceFolderGrant, type DeviceFolderKind, type MobileDeviceChatTool } from '@xopcai/endpoint-tools-protocol';

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

type LocalizedText = readonly [zh: string, en: string];
const DEVICE_CONNECTIONS_PATH = '/api/endpoint-tools/device-connections';
const mobileTools: ReadonlyArray<readonly [MobileDeviceChatTool, LucideIcon, LocalizedText, LocalizedText, LocalizedText, false?]> = [
  ['mobile.file.pick', Folder, ['阅读文件', 'Read a file'], ['从手机上选择一个文件，请助理阅读或总结。', 'Select a file on your phone to read or summarize.'],
    ['请在选中的手机上打开文件选择器，帮我阅读并总结所选文件。', 'Let me pick a file on the selected phone, then read and summarize it.']],
  ['mobile.media.pick', Image, ['解读照片', 'Analyze a photo'], ['从相册选一张照片，了解画面里的内容。', 'Choose a photo from your library and ask about what’s in it.'],
    ['请让我在选中的手机上从相册选择一张照片，然后帮我解读。', 'Let me pick a photo on the selected phone, then describe what’s in it.']],
  ['mobile.contacts.pick', Contact, ['选取联系方式', 'Pick contact details'], ['从手机通讯录选择一个电话号码。', 'Pick a phone number from your phone’s contacts.'],
    ['请让我从选中的手机通讯录里选择一个联系人的电话号码。', 'Let me pick a contact’s phone number on the selected phone.']],
  ['mobile.calendar.query_events', CalendarDays, ['查看日程', 'Check your schedule'], ['查看手机上今天的日程。', 'See today’s events on your phone.'],
    ['请查看选中的手机日历，告诉我今天有哪些安排。', 'Check the calendar on the selected phone and tell me what’s scheduled today.']],
  ['mobile.device.get_location', MapPin, ['使用当前位置', 'Use your location'], ['用手机的大致位置查询当地天气。', 'Check local weather using your phone’s approximate location.'],
    ['请用选中手机的大致位置查询当地天气。', 'Use the selected phone’s approximate location to check the local weather.']],
  ['mobile.camera.capture', Camera, ['拍照', 'Take a photo'], ['在手机上拍一张照片，带到对话里。', 'Take a photo on your phone and bring it into the chat.'],
    ['请在选中的手机上打开相机，让我拍一张照片。', 'Open the camera on the selected phone so I can take a photo.']],
  ['mobile.contacts.find_by_name', Contact, ['查找联系人', 'Find contacts'], ['按姓名查找联系方式。', 'Find contact details by name.'],
    ['请在选中的手机上查找联系人：', 'Find a contact on the selected phone: '], false],
  ['mobile.calendar.query_free_busy', CalendarDays, ['查看空闲时间', 'Check availability'], ['查看今天哪些时间有安排。', 'See when you are busy today.'],
    ['请查看选中手机上今天的空闲时间。', 'Check today’s availability on the selected phone.']],
  ['mobile.calendar.create_event', CalendarDays, ['创建日程', 'Create an event'], ['把对话中的安排添加到手机日历。', 'Add an event to your phone’s calendar.'],
    ['请在选中的手机上创建日程：', 'Create this event on the selected phone: '], false],
  ['mobile.media.list_recent', Image, ['最近照片', 'Recent photos'], ['查看最近拍摄的照片记录。', 'Find recently captured photos.'],
    ['请列出选中手机上最近拍摄的照片。', 'List the most recent photos on the selected phone.']],
  ['mobile.media.read_image', Image, ['读取照片', 'Read a photo'], ['使用照片编号读取对应的照片。', 'Read a photo by its ID.'],
    ['请从选中的手机读取这张照片，照片编号：', 'Read this photo from the selected phone. Photo ID: '], false],
  ['mobile.media.add_to_album', Image, ['整理相册', 'Organize albums'], ['按照片编号把照片加入指定相册。', 'Add a photo to an album by its ID.'],
    ['请把选中手机上的照片加入相册，照片编号和相册名称：', 'Add a photo on the selected phone to an album. Photo ID and album name: '], false],
  ['mobile.device.get_state', Smartphone, ['设备信息', 'Device information'], ['查看手机系统版本、语言和时区。', 'Check the phone’s system version, language and time zone.'],
    ['请查询选中手机的设备信息。', 'Check the selected phone’s device information.']],
  ['mobile.device.get_power', Battery, ['电量', 'Battery'], ['查看这部手机的电量和充电状态。', 'Check battery level and charging status.'],
    ['请查询选中手机的电量和充电状态。', 'Check battery level and charging status on the selected phone.']],
];
const names = { desktop: ['桌面', 'Desktop'], documents: ['文稿', 'Documents'], downloads: ['下载', 'Downloads'] } as const;
const desktopTools: ReadonlyArray<readonly [DesktopDeviceChatTool, LucideIcon, LocalizedText, LocalizedText, false?]> = [
  ['desktop.device.get_state', Monitor, ['查看系统版本、语言和时区。', 'Check the system version, language and time zone.'],
    ['请查询选中电脑的设备信息。', 'Check the selected computer’s device information.']],
  ['desktop.file.pick', Folder, ['从这台电脑选择一个文件并带到对话里。', 'Choose a file on this computer and bring it into the chat.'],
    ['请打开选中电脑的文件选择器，帮我阅读所选文件。', 'Open the file picker on the selected computer and read the file I choose.']],
  ['desktop.file.save', FileText, ['在这台电脑上选择位置保存文本。', 'Choose where to save text on this computer.'],
    ['请在选中的电脑上保存以下文本：', 'Save the following text on the selected computer: '], false],
  ['desktop.clipboard.read', Clipboard, ['把这台电脑剪贴板里的文字带到对话里。', 'Read text from this computer’s clipboard.'],
    ['请读取选中电脑剪贴板里的文字。', 'Read the clipboard text on the selected computer.']],
  ['desktop.clipboard.write', Clipboard, ['把指定文字复制到这台电脑的剪贴板。', 'Copy text to this computer’s clipboard.'],
    ['请把以下文字复制到选中电脑的剪贴板：', 'Copy this text to the selected computer’s clipboard: '], false],
  ['desktop.notification.show', Bell, ['在这台电脑上显示系统通知。', 'Show a system notification on this computer.'],
    ['请在选中的电脑显示通知，标题和内容是：', 'Show a notification on the selected computer. Title and message: '], false],
  ['desktop.app.open_external', Link2, ['用这台电脑的默认浏览器打开链接。', 'Open a link in this computer’s default browser.'],
    ['请在选中的电脑打开这个链接：', 'Open this link on the selected computer: '], false],
  ['desktop.computer.control', MousePointer2, ['使用已允许的应用窗口。', 'Use application windows that have been allowed.'],
    ['请在选中的电脑上操作这个应用：', 'Use this app on the selected computer: '], false],
];

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
  const desktopCapabilities = window.electronAPI?.deviceCapabilities;
  const catalog = useSWR(apiUrl(DEVICE_CONNECTIONS_PATH), async url => (
    await fetchJson<{ payload: DeviceConnections }>(url)
  ).payload, { refreshInterval: 5_000, shouldRetryOnError: false });
  const local = useSWR(desktop ? 'device-folders:status' : null, () => desktop?.status(), { refreshInterval: 3_000 });
  const localCapabilities = useSWR(desktopCapabilities ? 'device-capabilities:status' : null, () => desktopCapabilities?.status(), { refreshInterval: 3_000 });
  const [revoking, setRevoking] = useState<DeviceFolderGrant>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [changingCapability, setChangingCapability] = useState<DesktopDeviceChatTool>();
  const [capabilityError, setCapabilityError] = useState(false);
  const [startingTool, setStartingTool] = useState<{ deviceId: string; key: string }>();
  const [chatError, setChatError] = useState<{ deviceId: string; message: string }>();
  const folderTrigger = useRef<HTMLButtonElement>(null);
  const folderFallback = useRef<HTMLButtonElement>(null);
  const devices = catalog.data?.devices ?? [];
  const localEndpoint = localCapabilities.data?.endpointId ?? local.data?.endpointId;
  const localDevice = devices.find(device => device.endpointId && device.endpointId === localEndpoint);
  const locale = zh ? 0 : 1;
  const offlineHint = zh ? '让设备连上网络，再打开 xopc。' : 'Connect the device to the internet, then open xopc.';
  const folderName = (kind: DeviceFolderKind, label?: string) => kind === 'custom' ? (label ?? (zh ? '文件夹' : 'Folder')) : names[kind][locale];

  async function startChat(device: DeviceConnection, key: string, prompt: string, toolName?: DeviceChatTool, autoSend = true) {
    if (startingTool || device.availability === 'offline' || !device.endpointId) return;
    setStartingTool({ deviceId: device.id, key });
    setChatError(undefined);
    try {
      const { payload } = await fetchJson<{ payload: { conversationId: string } }>(apiUrl(`${DEVICE_CONNECTIONS_PATH}/chat`), {
        method: 'POST', body: JSON.stringify({ endpointId: device.endpointId, toolName }),
      });
      const query = new URLSearchParams({ draft: prompt, ...(autoSend && { autoSend: '1' }) });
      navigate(`/chat/${encodeURIComponent(payload.conversationId)}?${query}`);
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
      setChatError({ deviceId: device.id, message: status === 403
        ? (zh ? '请在来源设备的「设备连接」中授权后重试。' : 'Authorize this capability on the source device and try again.')
        : status === 409 ? (zh ? '此能力暂不可用，请打开设备上的 xopc 后重试。' : 'This capability is unavailable. Open xopc on the device and try again.')
        : (zh ? '暂时无法开启新对话，请重试。' : 'Unable to start a new chat. Try again.') });
      if (status === 403 || status === 409) void catalog.mutate().catch(() => {});
    } finally {
      setStartingTool(undefined);
    }
  }

  async function changeCapability(endpointId: string | undefined, toolName: DesktopDeviceChatTool, allowed: boolean) {
    if (!desktopCapabilities || !endpointId || changingCapability) return;
    setChangingCapability(toolName);
    setCapabilityError(false);
    try {
      await desktopCapabilities.change({ endpointId, toolName, allowed });
    } catch {
      setCapabilityError(true);
    } finally {
      await Promise.allSettled([localCapabilities.mutate(), catalog.mutate()]);
      setChangingCapability(undefined);
    }
  }

  function renderReportedDesktopCapabilities(device: DeviceConnection) {
    const isLocal = device.id === localDevice?.id;
    const canManage = isLocal && localCapabilities.data?.ready;
    const reported = desktopTools.flatMap(tool => {
      const capability = device.capabilities?.find(item => item.name === tool[0]);
      return capability ? [{ tool, capability }] : [];
    });
    if (!reported.length) return null;
    return <div className="space-y-3">
      <h3 className="text-sm font-semibold text-fg">{isLocal
        ? (zh ? '允许当前 Gateway 使用' : 'Allow the current Gateway to use')
        : (zh ? '电脑能力' : 'Computer capabilities')}</h3>
      {isLocal && capabilityError ? <p role="alert" className="text-sm text-danger">
        {zh ? '无法更新授权，请检查电脑与 Gateway 的连接后重试。' : 'Unable to update access. Check the computer’s connection to Gateway.'}
      </p> : null}
      <div className={CONNECTION_CARD_GRID_CLASS}>
        {reported.map(({ tool: [id, Icon, description, prompt, autoSend], capability }) => {
          const title = zh ? capability.titleZh : capability.title;
          const allowed = canManage ? localCapabilities.data?.allowed.includes(id) === true : capability.allowed;
          const unavailable = capability.requiresForeground && device.availability !== 'foreground';
          return <DeviceCapabilityCard key={id} icon={Icon} name={title} description={description[locale]}
            action={<div className="flex w-full flex-wrap items-center justify-end gap-x-2">
              <span className={cn('mr-auto text-xs', allowed ? 'text-emerald-700 dark:text-emerald-300' : 'text-fg-muted')}>
                {allowed ? (zh ? '已授权' : 'Authorized') : isLocal ? (zh ? '未授权' : 'Not authorized')
                  : (zh ? '在来源电脑上授权' : 'Authorize on the source computer')}
              </span>
              {id === 'desktop.computer.control' && isLocal ? <Button asChild variant="ghost" className="px-2 text-xs">
                <Link to="/settings/computer-use">{zh ? '应用权限' : 'App permissions'}</Link>
              </Button> : null}
              {capability.allowed && allowed && capability.needsSetup ? <span className="text-xs text-fg-muted">
                {zh ? '需在 Gateway 设置中启用电脑控制' : 'Enable Computer Use in Gateway settings'}
              </span> : capability.allowed && allowed && device.endpointId && chatButton(device, id, title, unavailable,
                () => void startChat(device, id, prompt[locale], id, autoSend))}
              {canManage ? <button type="button" role="switch" aria-checked={allowed}
                aria-label={zh ? `允许 Gateway 使用「${title}」` : `Allow Gateway to use ${title}`}
                disabled={Boolean(changingCapability)} onClick={() => void changeCapability(device.endpointId, id, !allowed)}
                className="touch-target flex shrink-0 items-center rounded-lg px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
                <span aria-hidden className={cn('flex h-6 w-11 items-center rounded-full p-0.5 transition-colors motion-reduce:transition-none',
                  allowed ? 'bg-accent' : 'bg-fg-muted/30')}>
                  <span className={cn('size-5 rounded-full bg-white transition-transform motion-reduce:transition-none', allowed && 'translate-x-5')} />
                </span>
              </button> : null}
            </div>} />;
        })}
      </div>
    </div>;
  }

  function chatButton(device: DeviceConnection, key: string, title: string, disabled: boolean, start: () => void) {
    return <Button variant="ghost" className={capabilityActionClass}
      disabled={disabled || Boolean(startingTool)}
      aria-label={zh ? `在新对话中使用「${title}」` : `Use ${title} in a new chat`}
      onClick={start}>
      {zh ? '新对话中使用' : 'Use in new chat'}
      {startingTool?.deviceId === device.id && startingTool.key === key
        ? <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
        : <ChevronRight className="size-3.5" aria-hidden />}
    </Button>;
  }

  async function changeFolder(input: DeviceFolderChange) {
    if (!desktop || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await desktop.change(input);
      if ('revoke' in input) {
        if (revoking?.kind === 'custom') folderTrigger.current = null;
        setRevoking(undefined);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      await Promise.allSettled([local.mutate(), catalog.mutate()]);
    }
  }

  function renderPhoneCapabilities(device: DeviceConnection) {
    const actions = mobileTools.filter(([id]) => device.capabilities
      ? device.capabilities.some(capability => capability.name === id) : device.tools.includes(id));
    if (actions.length === 0) return <p className="rounded-xl bg-surface-panel p-4 text-sm text-fg-muted">
      {zh ? '这部手机暂时没有可在对话中使用的功能。' : 'This phone has no features available for chats yet.'}
    </p>;
    return <div className="space-y-3">
      {device.availability === 'background' ? <p className="text-sm text-fg-muted">
        {zh ? '在手机上打开 xopc 后，即可从这里使用。' : 'Open xopc on your phone to use these features.'}
      </p> : null}
      {chatError?.deviceId === device.id ? <p role="alert" className="text-sm text-danger">{chatError.message}</p> : null}
      <div className={CONNECTION_CARD_GRID_CLASS}>
        {actions.map(([id, Icon, title, description, prompt, autoSend]) => {
          const capability = device.capabilities?.find(item => item.name === id);
          const allowed = capability?.allowed ?? !device.capabilities;
          const unavailable = (capability?.requiresForeground ?? true) && device.availability !== 'foreground';
          return <DeviceCapabilityCard key={id} icon={Icon} name={title[locale]} description={description[locale]}
            action={!allowed ? <span className="text-xs text-fg-muted">
              {zh ? '在手机的「设备连接」中授权' : 'Authorize in Device connections on your phone'}
            </span> : device.endpointId && chatButton(device, id, title[locale], unavailable,
              () => void startChat(device, id, prompt[locale], id, autoSend))} />;
        })}
      </div>
    </div>;
  }

  function renderComputerCapabilities(device: DeviceConnection) {
    const isLocal = device.id === localDevice?.id;
    const canManage = isLocal && local.data?.ready;
    const canAuthorize = canManage && local.data?.gatewayAccess === true;
    const grants = isLocal ? local.data?.folders ?? [] : [];
    const folders = isLocal ? grants : device.folders;
    const folderRows = [
      ...DEVICE_FOLDER_PRESETS.map(kind => ({ kind, folder: folders.find(row => row.kind === kind) })),
      ...folders.filter(folder => folder.kind === 'custom').map(folder => ({ kind: folder.kind, folder })),
    ];

    return <div className="space-y-3">
      {renderReportedDesktopCapabilities(device)}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-muted">
          {zh ? '在对话中查找并阅读已授权文件夹里的文件。' : 'Find and read files from approved folders in your chats.'}
        </p>
        {canAuthorize ? <Button ref={folderFallback} variant="secondary" className="shrink-0 text-xs" disabled={busy}
          onClick={() => void changeFolder({ kind: 'custom' })}>
          <Plus className="size-4" aria-hidden />{zh ? '添加文件夹' : 'Add folder'}
        </Button> : null}
      </div>
      {chatError?.deviceId === device.id ? <p role="alert" className="text-sm text-danger">{chatError.message}</p> : null}
      <div className={CONNECTION_CARD_GRID_CLASS}>
        {folderRows.map(({ kind, folder }) => {
          const grant = grants.find(entry => entry.id === folder?.id);
          const legacy = Boolean(grant && grant.access !== 'gateway');
          const access = !folder ? (zh ? '未授权' : 'Not authorized')
            : legacy ? (zh ? '仅限原授权范围 · 只读' : 'Previous access only · Read-only')
            : isLocal ? (zh ? '已授权给 Gateway · 只读' : 'Authorized for Gateway · Read-only') : (zh ? '已授权 · 只读' : 'Authorized · Read-only');
          const name = folderName(kind, folder?.label);
          const usable = folder?.access === 'gateway' && device.endpointId;
          return <DeviceCapabilityCard key={kind === 'custom' ? folder?.id : kind} icon={Folder} name={name} description={access}
            action={canManage || usable ? <div className="flex flex-wrap justify-end gap-2">
              {usable && folder ? chatButton(device, folder.id, name, false, () => void startChat(device, folder.id, zh
                ? `请在选中电脑的「${name}」里查找文件：` : `Find a file in “${name}” on the selected computer: `, undefined, false)) : null}
              {canAuthorize && (!grant || legacy) ? <Button variant="ghost" className={capabilityActionClass}
                disabled={busy} aria-label={zh ? `授权给 Gateway ${name}` : `Authorize Gateway for ${name}`}
                onClick={() => void changeFolder(grant ? { id: grant.id } : { kind })}>
                {zh ? '授权给 Gateway' : 'Authorize Gateway'}<ChevronRight className="size-3.5" aria-hidden />
              </Button> : null}
              {canManage && grant ? <Button variant="ghost" className={cn(capabilityActionClass, 'text-fg-muted hover:text-fg')}
                disabled={busy} aria-label={zh ? `撤销授权 ${name}` : `Revoke access to ${name}`}
                onClick={event => {
                  folderTrigger.current = event.currentTarget;
                  setFailed(false);
                  setRevoking(grant);
                }}>
                {zh ? '撤销授权' : 'Revoke access'}
              </Button> : null}
            </div> : null}
          />;
        })}
        {isLocal && !device.capabilities?.some(capability => capability.name === 'desktop.computer.control')
          && (device.platform === 'darwin' || device.platform === 'win32') ? <DeviceCapabilityCard
          icon={MousePointer2} name={zh ? '操作应用窗口' : 'Operate application windows'}
          description={zh ? '在设置中管理应用窗口操作权限。' : 'Manage access to application windows in settings.'}
          action={<Button asChild variant="ghost" className={capabilityActionClass}>
            <Link to="/settings/computer-use">{zh ? '设置' : 'Settings'}<ChevronRight className="size-3.5" aria-hidden /></Link>
          </Button>}
        /> : null}
      </div>
      {isLocal && failed && !revoking ? <p role="alert" className="text-sm text-danger">
        {zh ? '无法更新文件夹授权，请检查 Gateway 连接后重试。' : 'Could not update folder access. Check the Gateway connection and try again.'}
      </p> : null}
      {canManage && !canAuthorize ? <p className="text-sm text-fg-muted">
        {zh ? '更新电脑端和 Gateway 后，即可直接授权给 Gateway。' : 'Update the desktop app and Gateway to grant direct access.'}
      </p> : null}
      <p className="flex gap-2 text-xs leading-5 text-fg-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        {isLocal ? (zh ? '可随时撤销授权。选中文件的内容可能随对话发送给模型。' : 'You can revoke access at any time. Selected file content can be sent to your model.')
          : (zh ? '请在文件所在的电脑上更改访问设置。' : 'Change access on the computer where the files are stored.')}
      </p>
    </div>;
  }

  const orderedDevices = localDevice ? [localDevice, ...devices.filter(device => device.id !== localDevice.id)] : devices;

  return <>
    {catalog.isLoading || local.isLoading || localCapabilities.isLoading ? <div aria-busy="true" aria-label={zh ? '正在加载设备' : 'Loading devices'} className={cn(CONNECTION_CARD_GRID_CLASS, 'pt-3 lg:pt-4')}>
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
    <Dialog.Root open={Boolean(revoking)} onOpenChange={open => {
      if (!open && !busy) { setFailed(false); setRevoking(undefined); }
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
        <Dialog.Content
          className="xopc-dialog-content fixed left-1/2 top-1/2 z-[60] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-edge bg-surface-overlay p-5 shadow-float outline-none"
          onCloseAutoFocus={event => {
            event.preventDefault();
            (folderTrigger.current?.isConnected ? folderTrigger.current : folderFallback.current)?.focus();
          }}
        >
          <Dialog.Title className="font-semibold text-fg">{zh ? '撤销文件夹授权' : 'Revoke folder access'}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-fg-muted">
            {revoking ? (zh ? `Gateway 将无法再访问「${folderName(revoking.kind, revoking.label)}」。`
              : `Gateway will lose access to “${folderName(revoking.kind, revoking.label)}”.`) : null}
          </Dialog.Description>
          {failed ? <p role="alert" className="mt-2 text-sm text-danger">
            {zh ? '无法撤销授权，请重试。' : 'Could not revoke access. Try again.'}
          </p> : null}
          <footer className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild><Button variant="secondary" disabled={busy}>{zh ? '取消' : 'Cancel'}</Button></Dialog.Close>
            <Button variant="primary" disabled={busy} onClick={() => revoking && void changeFolder({ id: revoking.id, revoke: true })}>
              {zh ? '撤销授权' : 'Revoke access'}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
