import { existsSync, mkdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { release } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, powerMonitor, safeStorage, session, systemPreferences } from 'electron';
import { REMOTE_COMPUTER_CONTROL_TOOL, REMOTE_COMPUTER_DESCRIPTOR } from '@xopcai/computer-control-contract';
import { REMOTE_BROWSER_CONTROL_TOOL, REMOTE_BROWSER_DESCRIPTOR } from '@xopcai/browser-control-contract/remote';

import { DesktopEnrollmentManager, type DesktopEnrollmentAction } from '../desktop/enrollment.js';
import { DesktopIdentityStore } from '../desktop/device-identity.js';
import { desktopOperationStatusDescriptor } from '@xopcai/endpoint-tools-protocol';
import { DesktopOperationReviewManager } from '../desktop/operation-review.js';
import { DesktopExecutionManager } from '../desktop/execution-manager.js';
import { DesktopExecutionCatalog } from '../desktop/execution-catalog.js';
import { DesktopWorkspaceHelper } from '../desktop/workspace-helper.js';
import { DesktopWorkspaceSession } from '../desktop/workspace-session.js';
import { DesktopWorkspaceRecoveryStore } from '../desktop/workspace-recovery.js';
import { DesktopContainerEngine } from '../desktop/container-engine.js';
import { DesktopContainerResources } from '../desktop/container-resources.js';
import { DesktopContainerSession } from '../desktop/container-session.js';
import { DesktopContainerWorkspaces } from '../desktop/container-workspaces.js';
import { DesktopNativeApprovalFocus } from '../desktop/native-approval-focus.js';
import { DesktopComputerPresence } from '../desktop/computer-presence.js';
import { DesktopComputerResources } from '../desktop/computer-resources.js';
import { createNativeComputerSession } from '../desktop/computer-native-session.js';
import { createNativeBrowserSession } from '../desktop/browser-native-session.js';
import { DesktopBrowserResources } from '../desktop/browser-resources.js';
import type { DesktopBrowserSession } from '../desktop/browser-session.js';
import { DesktopExecutionStopOutbox } from '../desktop/execution-stop-outbox.js';
import { DesktopExecutionGrantLedger } from '../desktop/execution-grant-ledger.js';
import { computerHostBundleId } from '../desktop/computer-host-identity.js';
import type { DesktopComputerSession } from '../desktop/computer-session.js';
import { CuaComputerDriver } from '../computer/cua-driver.js';
import { resolveComputerDriverPath, resolveComputerDriverSdkUrl } from '../computer/desktop-host.js';
import { stopRecordedContainer } from '../desktop/container-worker.js';
import { DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR, desktopClipboardWorker } from '../desktop/clipboard-tool.js';
import { resolveStateDir } from '../../src/config/paths-state.js';
import { DesktopObservationManager } from '../desktop/observation-manager.js';
import { selectDesktopScreenSession } from '../desktop/screen-session.js';
import { installDesktopSessionBoundary } from '../desktop/session-boundary.js';
import { RemoteChatStateStore } from '../chat/state.js';
import { RemoteShellWindow } from '../shell/window.js';

import { GatewayConnectionPreview } from './connection-manager.js';
import { ConnectionCredentialStore } from './credentials.js';
import { ConnectionProfileStore } from './profiles.js';
import { ConnectionWindowPolicy, installConnectionIpcBoundary } from './restricted-ipc.js';
import { RemoteWindowPresentation } from './window-presentation.js';

export async function startGatewayConnectionPreview(entryUrl: string): Promise<void> {
  const presentation = new RemoteWindowPresentation(process.argv.includes('--gateway-connections-background'));
  // Remote file documents are explicitly unpacked; keep their resolver out of the local entry graph.
  const assetRoot = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked', 'out', 'preload')
    : join(dirname(fileURLToPath(entryUrl)), '../preload');
  const override = process.env['XOPC_ELECTRON_USER_DATA_DIR'];
  if (override) {
    const directory = resolve(override);
    mkdirSync(directory, { recursive: true });
    app.setPath('userData', directory);
  }
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  const policy = new ConnectionWindowPolicy();
  let shell: RemoteShellWindow | undefined;
  installConnectionIpcBoundary(ipcMain, (event, channel) => channel.startsWith('shell:')
    ? shell ? shell.authorize(event, channel) : (() => { throw new Error('REMOTE_CAPABILITY_DISABLED'); })()
    : policy.authorize(event, channel));
  await app.whenReady();
  const root = join(app.getPath('userData'), 'gateway-connections-v1');
  const encryption = {
    available: async () => {
      const available = await safeStorage.isAsyncEncryptionAvailable();
      return available && (process.platform !== 'linux'
        || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend()));
    },
    encrypt: (value: string) => safeStorage.encryptStringAsync(value),
    decrypt: async (value: Buffer) => (await safeStorage.decryptStringAsync(value)).result,
  };
  const manager = new GatewayConnectionPreview(new ConnectionProfileStore(root), new ConnectionCredentialStore(join(root, 'credentials'), encryption));
  const chatState = new RemoteChatStateStore(join(root, 'chat-state'), encryption);
  await manager.initialize();
  const isolated = session.fromPartition('gateway-connection-preview');
  isolated.setPermissionCheckHandler(() => false);
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.on('will-download', event => event.preventDefault());
  const documentPath = join(assetRoot, 'gateway-connections.html');
  const documentUrl = pathToFileURL(documentPath).href;
  const window = new BrowserWindow({ width: 780, height: 720, minWidth: 560, minHeight: 540,
    show: presentation.showInitially, paintWhenInitiallyHidden: presentation.showInitially,
    title: 'xopc · Gateway connections',
    webPreferences: { preload: join(assetRoot, 'connections.cjs'), session: isolated,
      contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, navigateOnDragDrop: false } });
  const desktopStore = new DesktopIdentityStore(join(root, 'desktop-identities'), encryption);
  const visible = () => !window.isDestroyed() && window.isVisible() && !window.isMinimized()
    && window.webContents.getURL() === documentUrl && window.webContents.mainFrame.url === documentUrl;
  const observation = new DesktopObservationManager({ manager, store: desktopStore, visible, appVersion: app.getVersion(),
    selectScreen: (binding, signal) => visible() ? selectDesktopScreenSession({ binding, signal, assets: assetRoot, parent: window, chat: shell?.captureWindow() }) : Promise.resolve(undefined),
    readState: async () => ({ platform: process.platform, systemVersion: release(), locale: app.getLocale(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    consent: async (binding, signal) => {
      if (!visible() || signal.aborted) return false;
      const result = await dialog.showMessageBox(window, { type: 'question', title: '授权只读设备状态',
        message: '允许此Gateway读取本机设备状态？',
        detail: `Gateway：${binding.origin}\n身份：${binding.gatewayId}\n\n仅提供平台、系统版本、语言、时区和采样时间。授权在本次连接内有效；不会读取屏幕、文件、剪贴板或执行命令。`,
        buttons: ['取消', '允许读取设备状态'], defaultId: 0, cancelId: 0, noLink: true, signal });
      return result.response === 1 && !signal.aborted && visible();
    },
  });
  let nativeApprovalGeneration = 0;
  const nativeApprovalFocus = new DesktopNativeApprovalFocus();
  const computerPresence = new DesktopComputerPresence(() => { computerContext = undefined; browserContext = undefined; void execution.stop(); });
  let computer: DesktopComputerSession | undefined, computerBundleId: string | undefined;
  let computerContext: { parent: BrowserWindow; generation: number } | undefined;
  let browser: DesktopBrowserSession | undefined;
  let browserContext: { parent: BrowserWindow; generation: number; expiresAt: number } | undefined;
  const foreground = () => {
    const chat = shell?.captureWindow();
    return visible() && window.isFocused() || Boolean(chat && chat.isVisible() && !chat.isMinimized() && chat.isFocused())
      || nativeApprovalFocus.focused(chat, nativeApprovalGeneration, process.platform === 'darwin' && app.isActive(), Boolean(chat && chat.isVisible() && !chat.isMinimized()))
      || computerPresence.visible();
  };
  let workspace: DesktopWorkspaceSession | undefined;
  let container: DesktopContainerSession | undefined;
  const containerResources = new DesktopContainerResources(join(resolveStateDir(), 'desktop-execution-v1', 'container-resources'), encryption);
  const containerWorkspaces = new DesktopContainerWorkspaces(join(resolveStateDir(), 'desktop-execution-v1', 'container-workspaces'), encryption);
  let savedContainers: { epoch: number; profileId: string; items: Array<{ workspaceId: string; label: string; imageId: string }> } | undefined;
  const workspaceRecovery = new DesktopWorkspaceRecoveryStore(join(resolveStateDir(), 'desktop-execution-v1', 'workspace-recovery'), encryption);
  const computerResources = new DesktopComputerResources(join(resolveStateDir(), 'desktop-execution-v1', 'computer-resources'), encryption);
  const browserResources = new DesktopBrowserResources(join(resolveStateDir(), 'desktop-execution-v1', 'browser-resources'), encryption);
  const stopOutbox = new DesktopExecutionStopOutbox(join(resolveStateDir(), 'desktop-execution-v1', 'stop-outbox'), encryption);
  const stopBrowser = async () => {
    computerPresence.close(); browserContext = undefined; await computerPresence.whenStopped();
    const previous = browser, outcome = await previous?.stop() ?? { confirmed: true };
    if (outcome.confirmed && browser === previous) browser = undefined;
    return outcome;
  };
  const stopComputer = async () => {
    computerPresence.close(); computerContext = undefined;
    await computerPresence.whenStopped();
    const previous = computer, outcome = await previous?.stop() ?? { confirmed: true };
    if (outcome.confirmed && computer === previous) computer = undefined;
    return outcome;
  };
  const execution = new DesktopExecutionManager({ manager, store: desktopStore, executorRoot: join(resolveStateDir(), 'desktop-execution-v1'),
    stopOutbox, grantLedger: new DesktopExecutionGrantLedger(join(resolveStateDir(), 'desktop-execution-v1', 'grant-ledger'), encryption),
    recoverResource: async intent => {
      if (intent.tool === REMOTE_BROWSER_CONTROL_TOOL || intent.tool === REMOTE_COMPUTER_CONTROL_TOOL) {
        try { return await (intent.tool === REMOTE_BROWSER_CONTROL_TOOL ? browserResources : computerResources).recoverAfterParentExit(intent); }
        catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
      }
      if (['desktop.command.run', 'desktop.terminal.open'].includes(intent.tool)) return proveContainerStopped(intent);
      // Clipboard runs in Main and workspace workers belong to Main; neither can survive the verified parent exit.
      return ['desktop.clipboard.write', 'desktop.workspace.write'].includes(intent.tool);
    },
    appVersion: app.getVersion(), catalog: new DesktopExecutionCatalog([DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR, desktopOperationStatusDescriptor()]), foreground,
    createTerminal: (intent, binding, emit, lease) => {
      if (!container) throw new Error('DESKTOP_TERMINAL_AUTHORITY_INVALID'); return container.terminal(intent, binding, emit, lease);
    },
    createComputer: uploadFrame => {
      const context = computerContext;
      if (!context || !computerBundleId || !computerPresence.visible()) throw new Error('DESKTOP_COMPUTER_AUTHORITY_INVALID');
      const current = () => computerContext === context && context.generation === nativeApprovalGeneration && computerPresence.visible();
      const sdkUrl = resolveComputerDriverSdkUrl({ packaged: app.isPackaged, resourcesPath: process.resourcesPath });
      const driver = new CuaComputerDriver(resolveComputerDriverPath({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, mainDir: dirname(fileURLToPath(entryUrl)) }),
        computerBundleId, sdkUrl ? () => import(/* @vite-ignore */ sdkUrl) : undefined, process.platform, current);
      computer = createNativeComputerSession({ driver, resources: computerResources, current, uploadFrame,
        requestApproval: async (request, signal) => {
          const detail = JSON.stringify(request);
          if (!current() || signal.aborted || Buffer.byteLength(detail) > 8192) return false;
          const result = await dialog.showMessageBox(context.parent, { type: 'warning', title: request.kind === 'session' ? '确认电脑控制目标' : '确认本次电脑输入',
            message: request.kind === 'session' ? '仅允许以下应用与模式？' : '向以下已核验窗口发送这次输入？',
            detail: `${detail}\n\n应用名称和内容可能来自不可信界面。仅本次有效，不继承本地模式的应用授权；结果未知不会自动重做。`,
            buttons: ['取消', request.kind === 'session' ? '允许本次目标' : '执行本次输入'], defaultId: 0, cancelId: 0, noLink: true, signal });
          return result.response === 1 && !signal.aborted && current();
        } });
      return computer;
    },
    createBrowser: uploadFrame => {
      const context = browserContext;
      if (!context || !computerPresence.visible()) throw new Error('DESKTOP_BROWSER_AUTHORITY_INVALID');
      const current = () => browserContext === context && context.generation === nativeApprovalGeneration && Date.now() < context.expiresAt && computerPresence.visible();
      browser = createNativeBrowserSession({ executable: process.execPath, ...(app.isPackaged ? {} : { appPath: fileURLToPath(entryUrl) }),
        resources: browserResources, current, uploadFrame, expiresAt: context.expiresAt,
        approve: async (command, tabs, signal) => {
          const detail = JSON.stringify({ command, tabs });
          if (!current() || signal.aborted || Buffer.byteLength(detail) > 24000 || context.parent.isDestroyed()) return false;
          const profile = manager.snapshot().profiles.find(item => item.id === manager.snapshot().selectedId);
          const result = await dialog.showMessageBox(context.parent, { type: 'warning', title: '确认本次浏览器操作',
            message: command.input.action === 'observe' ? '观察专用浏览器并将页面信息发送给此Gateway？' : '仅在专用浏览器执行以下请求？',
            detail: `Gateway：${profile?.origin}\n完整请求与专用标签页：${detail}\n\n页面标题和内容可能不可信。仅本次有效；输入可能保存、发送或删除数据，结果未知时不会自动重做。不能访问个人浏览器、上传本机路径或执行远端脚本。`,
            buttons: ['取消', '允许本次浏览器操作'], defaultId: 0, cancelId: 0, noLink: true, signal });
          return result.response === 1 && !signal.aborted && current();
        } });
      return browser;
    },
    confirmTerminalInput: async (scope, input, signal) => {
      const profile = manager.snapshot().profiles.find(profile => profile.id === manager.snapshot().selectedId), parent = shell?.captureWindow() ?? window;
      if (profile?.identity?.gatewayId !== scope.gatewayId || container?.workspaceId !== scope.workspaceId || !foreground() || signal.aborted || parent.isDestroyed()) return false;
      const generation = nativeApprovalGeneration;
      const bytes = Buffer.from(input.bytes, 'base64');
      const release = nativeApprovalFocus.begin(parent, generation, signal);
      try {
      const answer = await dialog.showMessageBox(parent, { type: 'warning', title: '确认本次终端输入', message: '将以下字节发送到隔离Docker终端？',
        detail: `Gateway：${profile.origin}\n设备：${scope.deviceId}\n工作区：${scope.workspaceId}\n会话：${scope.sessionId}\n代次：${scope.generation}\n输入：${input.inputId} / ${input.sequence}\n完整字节（Base64）：${input.bytes}\n文本预览（转义）：${JSON.stringify(bytes.toString('utf8'))}\n\n仅批准这次输入。接收回执不代表命令完成；断线或结果未知不会重放。`,
        buttons: ['取消', '发送本次终端输入'], defaultId: 0, cancelId: 0, noLink: true, signal });
      return answer.response === 1 && !signal.aborted && generation === nativeApprovalGeneration && foreground();
      } finally { release(); }
    },
    createWorker: (tool, intent) => {
      if (tool === DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR.name) return desktopClipboardWorker(clipboard);
      if (tool === 'desktop.command.run') {
        if (!container || !intent) throw new Error('DESKTOP_CONTAINER_AUTHORITY_INVALID'); return container.worker(intent);
      }
      if (!workspace) throw new Error('DESKTOP_EXECUTION_DENIED'); return workspace.worker(tool);
    },
    consent: async (binding, grant, signal) => {
      if (!visible() || !window.isFocused() || signal.aborted) return false;
      if (grant.toolRevisions[REMOTE_BROWSER_CONTROL_TOOL]) {
        const generation = nativeApprovalGeneration, epoch = manager.snapshot().epoch, parent = shell?.captureWindow() ?? window;
        const result = await dialog.showMessageBox(window, { type: 'warning', title: '授权本机专用浏览器', message: '允许此Gateway逐次请求操作独立浏览器？',
          detail: `Gateway：${binding.origin}\n身份：${binding.gatewayId}\n\n授权最长两分钟，每次观察、页面操作与标签页操作仍须本机确认。专用浏览器使用独立临时会话；页面信息与经批准的截图会发送给此Gateway。输入可能产生实际效果；不继承个人浏览器Cookie，不接受服务器文件路径或脚本。停止窗口保持可见；锁屏、最小化、断线、切换后须重新授权，结果未知不会重做。`,
          buttons: ['取消', '允许逐次确认浏览器操作'], defaultId: 0, cancelId: 0, noLink: true, signal });
        if (result.response !== 1 || signal.aborted || generation !== nativeApprovalGeneration || !foreground()) return false;
        const context = { parent, generation, expiresAt: grant.expiresAt }; browserContext = context;
        await computerPresence.begin(parent, () => {
          const state = manager.snapshot(), profile = state.profiles.find(item => item.id === binding.profileId);
          return browserContext === context && generation === nativeApprovalGeneration && state.epoch === epoch && state.selectedId === binding.profileId
            && profile?.identity?.gatewayId === binding.gatewayId && profile.identity.publicKey === binding.publicKey
            && (parent === window ? !window.isDestroyed() && window.webContents.getURL() === documentUrl && window.webContents.mainFrame.url === documentUrl : shell?.captureWindow() === parent);
        }, signal);
        return !signal.aborted && computerPresence.visible();
      }
      if (grant.toolRevisions[REMOTE_COMPUTER_CONTROL_TOOL]) {
        const generation = nativeApprovalGeneration, epoch = manager.snapshot().epoch, parent = shell?.captureWindow() ?? window;
        const result = await dialog.showMessageBox(window, { type: 'warning', title: '授权本机电脑控制', message: '允许此Gateway逐次请求观察与控制本机应用？',
          detail: `Gateway：${binding.origin}\n身份：${binding.gatewayId}\n\n授权最长两分钟。应用列表、目标选择、窗口截图和输入每次仍需本机确认；截图和界面信息发送给此Gateway。输入可能产生保存、发送或删除等实际效果。聊天/停止窗口将在其他桌面保持可见；目标应用可持有焦点。最小化、关闭、锁屏、断线或切换后需重新授权，旧输入不会重放。不能访问任意Electron IPC、运行主机命令或继承本地应用授权。`,
          buttons: ['取消', '允许逐次确认电脑控制'], defaultId: 0, cancelId: 0, noLink: true, signal });
        if (result.response !== 1 || signal.aborted || generation !== nativeApprovalGeneration || !foreground()) return false;
        const context = { parent, generation }; computerContext = context;
        await computerPresence.begin(parent, () => {
          const state = manager.snapshot(), profile = state.profiles.find(item => item.id === binding.profileId);
          return computerContext === context && generation === nativeApprovalGeneration && state.epoch === epoch && state.selectedId === binding.profileId
            && profile?.identity?.gatewayId === binding.gatewayId && profile.identity.publicKey === binding.publicKey
            && (parent === window ? !window.isDestroyed() && window.webContents.getURL() === documentUrl && window.webContents.mainFrame.url === documentUrl : shell?.captureWindow() === parent);
        }, signal);
        return !signal.aborted && computerPresence.visible();
      }
      if (grant.toolRevisions['desktop.command.run'] || grant.toolRevisions['desktop.terminal.open']) {
        if (!container || container.workspaceId !== grant.workspaceId) return false;
        const generation = nativeApprovalGeneration;
        const result = await dialog.showMessageBox(window, { type: 'warning', title: grant.toolRevisions['desktop.terminal.open'] ? '授权本机Docker终端' : '授权本机Docker命令', message: grant.toolRevisions['desktop.terminal.open'] ? '允许此Gateway请求打开独立Docker终端？输出会发送给Gateway，每次输入仍需本机确认。' : '允许此Gateway请求在独立Docker工作区运行命令？',
          detail: `Gateway：${binding.origin}\n身份：${binding.gatewayId}\n镜像：${container.imageId}\n隔离工作区：${container.workspaceId}\n数据：${container.retainedData() ? '重新使用保留的隔离卷，旧授权不恢复' : '新建隔离卷'}\n\n授权最长两分钟，每个命令仍须逐次本机批准。容器无网络，以非root运行，不挂载本机目录或Docker socket，不传递主机凭据。命令仅修改本隔离卷，卷保留供核实；不会直接修改本机工作区。锁屏、断线或切换后需重新授权，停止未确认时不能接管。`,
          buttons: ['取消', '允许逐次确认容器命令'], defaultId: 0, cancelId: 0, noLink: true, signal });
        if (result.response !== 1 || signal.aborted || generation !== nativeApprovalGeneration || !foreground()) return false;
        await container.authorizeWorkspace(signal); return !signal.aborted && generation === nativeApprovalGeneration && foreground();
      }
      if (grant.workspaceId) {
        if (workspace?.workspaceId !== grant.workspaceId) return false;
        const result = await dialog.showMessageBox(window, { type: 'warning', title: '授权本机工作区',
          message: '允许此 Gateway 请求访问所选本机目录？',
          detail: `Gateway：${binding.origin}\n身份：${binding.gatewayId}\n本机目录：${JSON.stringify(workspace.identity().path)}\n工作区：${grant.workspaceId}\n\n授权最长两分钟。目录列表、文本读取和写入每次均需本机批准；读取内容会发送给此Gateway。写入须核对内容版本，可能与外部编辑冲突，取消或崩溃后可能需要核实部分效果。不会执行命令、控制浏览器或访问目录以外的路径。断线、锁屏、切换后不会自动恢复。`,
          buttons: ['取消', '允许逐次确认目录访问'], defaultId: 0, cancelId: 0, noLink: true, signal });
        return result.response === 1 && !signal.aborted && visible();
      }
      const result = await dialog.showMessageBox(window, { type: 'question', title: '授权本机剪贴板写入',
        message: '允许此 Gateway 请求写入本机剪贴板？',
        detail: `Gateway：${binding.origin}\n身份：${binding.gatewayId}\n\n授权最长两分钟，仅允许写入不超过4000字符的文本；每次仍需本机确认。可查询本机操作元数据，但不包含参数正文。不会读取现有剪贴板、文件或执行命令。断线、锁屏、切换连接后需重新授权。`,
        buttons: ['取消', '允许逐次确认写入'], defaultId: 0, cancelId: 0, noLink: true, signal });
      return result.response === 1 && !signal.aborted && visible();
    },
    confirm: async (request, signal) => {
      const profile = manager.snapshot().profiles.find(profile => profile.id === manager.snapshot().selectedId);
      const parent = shell?.captureWindow() ?? window;
      if (profile?.identity?.gatewayId !== request.execution.gatewayId || !foreground() || signal.aborted || parent.isDestroyed()) return false;
      // The dedicated Broker requests native consent with locally observed tab metadata after its durable barrier.
      if (request.toolName === REMOTE_BROWSER_CONTROL_TOOL) return Boolean(browserContext && computerPresence.visible());
      if (request.toolName === REMOTE_COMPUTER_CONTROL_TOOL) {
        const detail = JSON.stringify(request.arguments), generation = nativeApprovalGeneration;
        if (!computerPresence.visible() || Buffer.byteLength(detail) > 8192) return false;
        // Releasing the already bound session cannot observe or perform input and must not wait behind an approval dialog.
        if (request.arguments.op === 'release') return true;
        const result = await dialog.showMessageBox(parent, { type: 'warning', title: '确认本次电脑操作',
          message: request.arguments.op === 'observe' ? '截取已授权窗口并发送给此Gateway？' : request.arguments.op === 'discover' ? '将本机应用列表发送给此Gateway？' : '仅执行以下电脑控制请求？',
          detail: `Gateway：${profile.origin}\n设备：${request.execution.deviceId}\n操作：${request.execution.operationId}\n完整请求：${detail}\n\n每个输入还会核验目标并单独请求批准。结果未知时不会重做。`,
          buttons: ['取消', '允许本次电脑操作'], defaultId: 0, cancelId: 0, noLink: true, signal });
        return result.response === 1 && !signal.aborted && generation === nativeApprovalGeneration && computerPresence.visible();
      }
      if (['desktop.command.run', 'desktop.terminal.open'].includes(request.toolName)) {
        if (!container || request.execution.workspaceId !== container.workspaceId || request.arguments.workspaceId !== container.workspaceId) return false;
        const generation = nativeApprovalGeneration;
        const result = await dialog.showMessageBox(parent, { type: 'warning', title: request.toolName === 'desktop.terminal.open' ? '确认打开隔离终端' : '确认本次容器命令', message: request.toolName === 'desktop.terminal.open' ? '以以下argv打开隔离终端？每次输入仍需本机确认。' : '运行以下隔离容器命令？',
          detail: `Gateway：${profile.origin}\n设备：${request.execution.deviceId}\n镜像：${container.imageId}\n隔离工作区：${container.workspaceId}\n操作：${request.execution.operationId}\n参数摘要：${request.execution.argumentHash}\n\n完整argv：\n${JSON.stringify(request.arguments.argv)}\n\n仅本次有效。容器无网络或本机目录挂载；专用卷内的修改可能在中断后保留。返回非零退出码不代表没有副作用；结果未知时不会重做。`,
          buttons: ['取消', request.toolName === 'desktop.terminal.open' ? '打开本次隔离终端' : '运行本次容器命令'], defaultId: 0, cancelId: 0, noLink: true, signal });
        return result.response === 1 && !signal.aborted && generation === nativeApprovalGeneration && foreground();
      }
      if (request.toolName === 'desktop.workspace.write') {
        if (!workspace || request.execution.workspaceId !== workspace.workspaceId || request.arguments.workspaceId !== workspace.workspaceId) return false;
        const text = typeof request.arguments.text === 'string' ? request.arguments.text : '';
        const result = await dialog.showMessageBox(parent, { type: 'warning', title: '确认本次工作区写入',
          message: '写入以下本机工作区文件？',
          detail: `Gateway：${profile.origin}\n设备：${request.execution.deviceId}\n本机目录：${JSON.stringify(workspace.identity().path)}\n相对路径：${JSON.stringify(request.arguments.relativePath)}\n操作：${request.execution.operationId}\n预期版本：${request.arguments.expectedVersion === null ? '新建，要求文件不存在' : request.arguments.expectedVersion}\n参数摘要：${request.execution.argumentHash}\n\n共${Buffer.byteLength(text, 'utf8')}字节，预览前2000字符：\n${JSON.stringify(text.slice(0, 2000))}\n\n批准完整参数对应的本次写入。版本冲突时拒绝；不保证与外部编辑器的全局原子互斥。中断可能留下部分效果，旧操作不会自动重做。`,
          buttons: ['取消', '写入本次文件'], defaultId: 0, cancelId: 0, noLink: true, signal });
        if (result.response !== 1 || signal.aborted || !foreground()) return false;
        await workspaceRecovery.save(request.execution, request.arguments, workspace.identity());
        return !signal.aborted && foreground();
      }
      const result = await dialog.showMessageBox(parent, { type: 'question', title: '确认本次剪贴板写入',
        message: '将以下文本写入本机剪贴板？',
        detail: `Gateway：${profile.origin}\n设备：${request.execution.deviceId}\n操作：${request.execution.operationId}\n\n${JSON.stringify(request.arguments.text)}\n\n仅本次有效。现有剪贴板内容将被替换。`,
        buttons: ['取消', '写入本次文本'], defaultId: 0, cancelId: 0, noLink: true, signal });
      return result.response === 1 && !signal.aborted && foreground();
    },
    confirmRead: async (request, signal) => {
      const profile = manager.snapshot().profiles.find(profile => profile.id === manager.snapshot().selectedId), parent = shell?.captureWindow() ?? window;
      if (!workspace || request.workspaceId !== workspace.workspaceId || profile?.identity?.gatewayId !== request.gatewayId || !foreground() || signal.aborted || parent.isDestroyed()) throw new Error('WORKSPACE_READ_AUTHORITY_INVALID');
      const result = await dialog.showMessageBox(parent, { type: 'question', title: '确认本次工作区读取',
        message: request.toolName === 'desktop.workspace.list' ? '将本机目录列表发送给此Gateway？' : '将本机文件文本发送给此Gateway？',
        detail: `Gateway：${profile.origin}\n设备：${request.deviceId}\n本机目录：${JSON.stringify(workspace.identity().path)}\n相对路径：${JSON.stringify(request.arguments.relativePath)}\n\n仅本次有效。文本最多32768 UTF-8字节，目录最多100项；不会修改文件，不访问符号链接或目录外路径。`,
        buttons: ['取消', '允许本次读取'], defaultId: 0, cancelId: 0, noLink: true, signal });
      if (signal.aborted) throw new Error('WORKSPACE_READ_CANCELLED');
      if (result.response !== 1) return false;
      if (!foreground()) throw new Error('WORKSPACE_READ_AUTHORITY_INVALID');
      return true;
    },
  });
  let localOperationReviews: Awaited<ReturnType<DesktopOperationReviewManager['listLocal']>> | undefined;
  let operationReviews: { profileId: string; epoch: number; items: Awaited<ReturnType<DesktopOperationReviewManager['list']>> } | undefined;
  const proveContainerStopped = async (intent: Parameters<typeof stopRecordedContainer>[1]) => {
    if (!['desktop.command.run', 'desktop.terminal.open'].includes(intent.tool)) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([stopRecordedContainer(containerResources, intent), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 3000); })]);
    } catch { return false; } finally { clearTimeout(timer); }
  };
  const reviews = new DesktopOperationReviewManager({ manager, execution, store: desktopStore, executorRoot: join(resolveStateDir(), 'desktop-execution-v1'), visible,
    proveStopped: intent => intent.tool === REMOTE_BROWSER_CONTROL_TOOL ? browserResources.recoverAfterParentExit(intent).catch(() => false)
      : intent.tool === REMOTE_COMPUTER_CONTROL_TOOL ? computerResources.recoverAfterParentExit(intent).catch(() => false) : proveContainerStopped(intent),
    confirm: async (binding, intent, receipt, signal) => {
      if (!visible() || !window.isFocused() || signal.aborted) return false;
      const file = intent.tool === 'desktop.workspace.write' ? await workspaceRecovery.load(intent) : undefined;
      const command = ['desktop.command.run', 'desktop.terminal.open'].includes(intent.tool) ? await containerResources.load(intent) : undefined;
      if (command && command.phase !== 'stopped' && !await proveContainerStopped(intent)) throw new Error('DESKTOP_EXECUTION_STOP_UNCONFIRMED');
      const commandDetail = command ? `\n镜像：${command.imageId}\n隔离工作区：${command.workspaceId}\nDocker卷：xopc-workspace-${command.ownerId}-${command.workspaceId}\n完整argv：${JSON.stringify(command.argv)}\n容器已核实删除，但隔离卷内的修改可能仍存在；不会自动删除卷或重做命令。` : '';
      if (signal.aborted || !visible() || !window.isFocused()) return false;
      const answer = await dialog.showMessageBox(window, { type: 'warning', title: '核实结果未知的操作',
        message: '检查实际效果后，仅允许后续的新操作？',
        detail: `Gateway：${binding.origin}\n操作：${intent.operationId}\n工具：${intent.tool}\n本机记录：${receipt?.state ?? '未找到匹配记录'}${file ? `\n原本机目录：${JSON.stringify(file.root.path)}\n目录身份：${file.root.device}:${file.root.inode}\n相对路径：${JSON.stringify(file.relativePath)}\n原预期版本：${file.expectedVersion ?? '新建'}\n路径可能已被移动或替换，请核实原目录身份及部分写入效果。` : ''}${commandDetail}\n\n请先检查实际效果；旧操作可能已经生效。此次确认不会将旧结果改成成功，也不会重做旧操作。执行器已停止，每个新写入仍需另行授权。${binding.offline ? '\n\n这是本机离线核实，原服务器尚未确认，旧任务结果仍保持未知。' : ''}`,
        buttons: ['取消', '已检查，允许新意图'], defaultId: 0, cancelId: 0, noLink: true, signal });
      return answer.response === 1 && !signal.aborted && visible() && window.isFocused();
    } });
  const stopObservation = () => { observation.stop(); void shell?.setHostOrigin().catch(() => {}); };
  const stopCapabilities = () => { nativeApprovalGeneration += 1; computerPresence.close(); computerContext = undefined; browserContext = undefined; shell?.stopFiles(); reviews.cancel(); stopObservation(); void execution.stop(); };
  const cancelDesktop = () => { stopCapabilities(); desktop.cancel(); operationReviews = undefined; savedContainers = undefined; };
  const removeSessionBoundary = installDesktopSessionBoundary(powerMonitor, cancelDesktop);
  window.once('closed', removeSessionBoundary);
  const desktop = new DesktopEnrollmentManager({ manager, store: desktopStore, visible,
    consent: async (binding, signal, reenroll) => {
      if (window.isDestroyed() || !window.isVisible() || window.isMinimized() || signal.aborted) return false;
      const answer = await dialog.showMessageBox(window, {
        type: 'question', title: reenroll ? '重新登记电脑身份' : '登记电脑身份',
        message: reenroll ? '是否为这台电脑建立新的登记？' : '是否向此Gateway登记这台电脑？',
        detail: `Gateway：${binding.origin}\n身份：${binding.gatewayId}\n\n登记只用于确认电脑身份。屏幕、文件和命令等能力需要另行授权。`,
        buttons: ['取消', reenroll ? '重新登记' : '登记此电脑'], defaultId: 0, cancelId: 0, noLink: true, signal,
      });
      return answer.response === 1 && !signal.aborted && !window.isDestroyed() && window.isVisible() && !window.isMinimized()
        && window.webContents.getURL() === documentUrl && window.webContents.mainFrame.url === documentUrl;
    },
  });
  policy.register(window.webContents, documentUrl);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'xopc', submenu: [{ label: '立即停止本机执行', click: () => { stopCapabilities(); } }, { role: 'quit' }] },
    { role: 'editMenu' },
  ]));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => event.preventDefault());
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace && window.webContents.getURL() === documentUrl) { cancelDesktop(); policy.revoke(); }
  });
  window.webContents.on('did-navigate-in-page', (_event, url, mainFrame) => {
    if (mainFrame && url !== documentUrl) { cancelDesktop(); policy.revoke(); }
  });
  window.webContents.on('render-process-gone', () => { cancelDesktop(); policy.revoke(); });
  window.on('closed', () => { cancelDesktop(); policy.revoke(); void shell?.close().then(() => app.quit(), () => app.quit()); });
  app.on('second-instance', () => presentation.reveal(window, true));
  shell = new RemoteShellWindow(dirname(fileURLToPath(entryUrl)), assetRoot, manager, () => { stopCapabilities(); presentation.reveal(window); }, chatState, presentation, {
    root: join(root, 'remote-file-snapshots'), encryption,
    confirm: async (snapshot, signal) => {
      const parent = shell?.captureWindow(), approval = nativeApprovalGeneration;
      const profile = manager.snapshot().profiles.find(profile => profile.id === manager.snapshot().selectedId);
      if (!parent?.isFocused() || !profile?.identity || signal.aborted) return false;
      const result = await dialog.showMessageBox(parent, { type: 'warning', title: '回传远端文件编辑', message: '将此缓存副本回传到Gateway？',
        detail: `Gateway：${profile.origin}\n文件：${JSON.stringify(snapshot.resource.name)}\n资源：${snapshot.resource.id}\n原版本：${snapshot.resource.revision}\n正文摘要：${createHash('sha256').update(snapshot.text).digest('hex')}\n大小：${Buffer.byteLength(snapshot.text)}字节\n\n仅此次显式回传。服务器版本冲突时拒绝，不自动覆盖；断网或超时后可能已生效，将保留未知状态且不重发。此操作不会写入本机工作区。`,
        buttons: ['取消', '回传本次编辑'], defaultId: 0, cancelId: 0, noLink: true, signal });
      return result.response === 1 && !signal.aborted && approval === nativeApprovalGeneration && !parent.isDestroyed() && parent.isFocused();
    },
  });
  const snapshot = () => ({ ...manager.snapshot(), localCapabilities: Boolean(execution.origin() || observation.origin()), desktop: desktop.snapshot(), observation: observation.snapshot(), execution: execution.snapshot(), localOperationReviews,
    savedContainers: savedContainers?.epoch === manager.snapshot().epoch && savedContainers.profileId === manager.snapshot().selectedId ? savedContainers : undefined,
    operationReviews: operationReviews?.epoch === manager.snapshot().epoch ? operationReviews : undefined, presentation: {
    connectionVisible: window.isVisible(), connectionFocused: window.isFocused(), chat: shell!.presentationState(),
  } });
  let operations = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => { const next = operations.then(work); operations = next.then(() => {}, () => {}); return next; };
  const atEpoch = <T>(epoch: unknown, work: () => Promise<T>) => serialize(() => {
    if (epoch !== manager.snapshot().epoch) throw new Error('STALE_CONNECTION_EPOCH');
    return work();
  });
  const reply = async (work: () => unknown) => {
    try { return { ok: true, snapshot: await work() }; }
    catch (error) {
      const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'CONNECTION_STORAGE_FAILED';
      return { ok: false, error: code, snapshot: window.isDestroyed() ? manager.snapshot() : snapshot() };
    }
  };
  ipcMain.handle('connections:snapshot', snapshot);
  ipcMain.handle('connections:save', (_event, epoch, input) => {
    if (Buffer.byteLength(JSON.stringify(input) ?? '') > 16 * 1024) return { ok: false, error: 'CONNECTION_REQUEST_TOO_LARGE' };
    return reply(() => atEpoch(epoch, async () => { cancelDesktop(); await execution.requireStopped(); await shell!.close(); const result = await manager.save(epoch, input); await chatState.prune(result.profiles); return snapshot(); }));
  });
  ipcMain.handle('connections:select', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => { cancelDesktop(); await execution.requireStopped(); await shell!.close(); await manager.select(epoch, id); return snapshot(); })));
  ipcMain.handle('connections:remove', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => { cancelDesktop(); await execution.requireStopped(); await shell!.close(); const result = await manager.remove(epoch, id); await chatState.prune(result.profiles); return snapshot(); })));
  ipcMain.handle('connections:connect', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => { cancelDesktop(); await execution.requireStopped(); await shell!.connect(epoch, id); return snapshot(); })));
  ipcMain.handle('shell:bootstrap', event => serialize(() => { shell!.authorize(event, 'shell:bootstrap'); return shell!.bootstrap(); }));
  ipcMain.handle('shell:recover', event => serialize(async () => { shell!.authorize(event, 'shell:recover'); stopCapabilities(); await execution.requireStopped(); await shell!.close(); presentation.reveal(window); return { ok: true }; }));
  ipcMain.handle('shell:host-settings', event => { shell!.authorize(event, 'shell:host-settings'); presentation.reveal(window); return { ok: true }; });
  ipcMain.handle('shell:host-origin', async event => {
    shell!.authorize(event, 'shell:host-origin'); const origin = await execution.readyOrigin() ?? await observation.readyOrigin();
    await shell!.setHostOrigin(origin);
    if (JSON.stringify(origin) !== JSON.stringify(execution.origin() ?? observation.origin())) { await shell!.setHostOrigin(); return; }
    return origin;
  });
  ipcMain.handle('shell:host-stop', event => { shell!.authorize(event, 'shell:host-stop'); stopCapabilities(); return { ok: true }; });
  ipcMain.handle('shell:state-read', event => serialize(() => { shell!.authorize(event, 'shell:state-read'); return shell!.readState(); }));
  ipcMain.handle('shell:file-action', async (event, action, input) => {
    shell!.authorize(event, 'shell:file-action');
    if (Buffer.byteLength(JSON.stringify(input) ?? '') > 256 * 1024) return { ok: false, error: 'REMOTE_FILE_REQUEST_TOO_LARGE' };
    try { return { ok: true, value: await shell!.fileAction(action, input) }; }
    catch (error) { return { ok: false, error: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'REMOTE_FILE_REQUEST_FAILED' }; }
  });
  ipcMain.handle('shell:state-write', (event, value) => {
    if (Buffer.byteLength(JSON.stringify(value) ?? '') > 256 * 1024) throw new Error('CHAT_STATE_TOO_LARGE');
    return serialize(() => { shell!.authorize(event, 'shell:state-write'); return shell!.writeState(value); });
  });
  for (const action of ['enroll', 'check', 'disable', 'reenroll'] as DesktopEnrollmentAction[]) {
    ipcMain.handle(`connections:desktop-${action}`, (_event, epoch, id) => reply(async () => {
      if (epoch !== manager.snapshot().epoch) throw new Error('STALE_CONNECTION_EPOCH');
      if (action !== 'check') { stopCapabilities(); await execution.requireStopped(); }
      try { await desktop.perform(action, epoch, id); }
      catch (error) { if (error instanceof Error && error.message === 'DESKTOP_AUTH_REVOKED') stopCapabilities(); throw error; }
      return snapshot();
    }));
  }
  ipcMain.handle('connections:observation-start', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => { if (id !== manager.snapshot().selectedId) throw new Error('STALE_CONNECTION_EPOCH'); await execution.requireStopped(); await observation.start(epoch, id); return snapshot(); })));
  ipcMain.handle('connections:screen-start', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => { if (id !== manager.snapshot().selectedId) throw new Error('STALE_CONNECTION_EPOCH'); await execution.requireStopped(); await observation.start(epoch, id, 'screen'); return snapshot(); })));
  ipcMain.handle('connections:observation-stop', () => { stopObservation(); return { ok: true, snapshot: snapshot() }; });
  ipcMain.handle('connections:local-operations', (_event, epoch) => reply(() => atEpoch(epoch, async () => {
    localOperationReviews = await reviews.listLocal(epoch); return snapshot();
  })));
  ipcMain.handle('connections:local-operation-review', (_event, epoch, operationId) => reply(() => atEpoch(epoch, async () => {
    await reviews.reviewLocal(epoch, operationId); localOperationReviews = await reviews.listLocal(epoch); return snapshot();
  })));
  ipcMain.handle('connections:operation-list', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => {
    const items = await reviews.list(epoch, id); operationReviews = { epoch: epoch as number, profileId: id as string, items }; return snapshot();
  })));
  ipcMain.handle('connections:operation-review', (_event, epoch, id, operationId) => reply(() => atEpoch(epoch, async () => {
    await reviews.review(epoch, id, operationId);
    const items = await reviews.list(epoch, id); operationReviews = { epoch: epoch as number, profileId: id as string, items }; return snapshot();
  })));
  ipcMain.handle('connections:execution-start', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => { if (id !== manager.snapshot().selectedId) throw new Error('STALE_CONNECTION_EPOCH'); stopObservation(); await observation.whenStopped(); await execution.start(epoch, id); return snapshot(); })));
  ipcMain.handle('connections:workspace-start', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => {
    const state = manager.snapshot(), profile = state.profiles.find(profile => profile.id === id);
    if (id !== state.selectedId || !profile?.identity) throw new Error('STALE_CONNECTION_EPOCH');
    if (process.platform !== 'darwin') throw new Error('DESKTOP_WORKSPACE_UNSUPPORTED');
    const addon = app.isPackaged ? join(process.resourcesPath, 'bin/desktop-workspace.node') : join(app.getAppPath(), 'dist/electron/native/desktop-workspace.node');
    const worker = app.isPackaged ? join(process.resourcesPath, 'bin/workspace-worker.cjs') : join(app.getAppPath(), 'electron/desktop/workspace-worker.cjs');
    if (!existsSync(addon) || !existsSync(worker)) throw new Error('DESKTOP_WORKSPACE_UNAVAILABLE');
    stopObservation(); await observation.whenStopped(); await execution.requireStopped();
    const generation = nativeApprovalGeneration;
    const current = () => generation === nativeApprovalGeneration && manager.snapshot().epoch === epoch && manager.snapshot().selectedId === id
      && manager.snapshot().profiles.find(item => item.id === id)?.identity?.gatewayId === profile.identity!.gatewayId;
    if (!visible() || !window.isFocused()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
    const choice = await dialog.showOpenDialog(window, { title: '选择允许逐次确认访问的本机工作区', properties: ['openDirectory', 'dontAddToRecent'] });
    if (!current() || !visible() || !window.isFocused()) throw new Error('DESKTOP_OPERATION_CANCELLED');
    if (choice.canceled || choice.filePaths.length !== 1) throw new Error('DESKTOP_LOCAL_CONSENT_DENIED');
    const helper = await DesktopWorkspaceHelper.open(addon, await realpath(choice.filePaths[0]), worker);
    const selected = new DesktopWorkspaceSession({ helper, current }); workspace = selected;
    if (!current() || !foreground()) { await selected.stop(); throw new Error('DESKTOP_OPERATION_CANCELLED'); }
    await selected.activate(execution, epoch, id);
    return snapshot();
  })));
  ipcMain.handle('connections:execution-stop', () => reply(async () => { stopCapabilities(); await execution.stop(); return snapshot(); }));
  ipcMain.handle('connections:stop-receipts', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => { await execution.flushStopReceipts(epoch, id); return snapshot(); })));
  ipcMain.handle('connections:computer-start', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => {
    if (process.platform !== 'darwin') throw new Error('DESKTOP_COMPUTER_UNSUPPORTED');
    const state = manager.snapshot(), profile = state.profiles.find(item => item.id === id);
    if (id !== state.selectedId || !profile?.identity) throw new Error('STALE_CONNECTION_EPOCH');
    if (!visible() || !window.isFocused()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
    stopObservation(); await observation.whenStopped(); await execution.requireStopped();
    if (!systemPreferences.isTrustedAccessibilityClient(false) || systemPreferences.getMediaAccessStatus('screen') !== 'granted') throw new Error('DESKTOP_COMPUTER_PERMISSIONS_REQUIRED');
    const generation = nativeApprovalGeneration;
    computerBundleId = await computerHostBundleId({ packaged: app.isPackaged, resourcesPath: process.resourcesPath });
    if (generation !== nativeApprovalGeneration || !foreground() || manager.snapshot().epoch !== epoch) throw new Error('DESKTOP_OPERATION_CANCELLED');
    await execution.start(epoch, id, { kind: 'computer', catalog: new DesktopExecutionCatalog([REMOTE_COMPUTER_DESCRIPTOR as never, desktopOperationStatusDescriptor()]), stopResources: stopComputer });
    return snapshot();
  })));
  ipcMain.handle('connections:browser-start', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => {
    if (process.platform !== 'darwin') throw new Error('DESKTOP_BROWSER_UNSUPPORTED');
    const state = manager.snapshot(), profile = state.profiles.find(item => item.id === id);
    if (id !== state.selectedId || !profile?.identity) throw new Error('STALE_CONNECTION_EPOCH');
    if (!visible() || !window.isFocused()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
    stopObservation(); await observation.whenStopped(); await execution.requireStopped();
    await execution.start(epoch, id, { kind: 'browser', catalog: new DesktopExecutionCatalog([REMOTE_BROWSER_DESCRIPTOR as never, desktopOperationStatusDescriptor()]), stopResources: stopBrowser });
    return snapshot();
  })));
  ipcMain.handle('connections:container-list', (_event, epoch, id) => reply(() => atEpoch(epoch, async () => {
    const state = manager.snapshot(), profile = state.profiles.find(profile => profile.id === id);
    if (id !== state.selectedId || !profile?.identity) throw new Error('STALE_CONNECTION_EPOCH');
    if (!visible() || !window.isFocused()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
    const items = await containerWorkspaces.list({ profileId: id, origin: profile.origin, ...profile.identity });
    savedContainers = { epoch: state.epoch, profileId: id, items: items.map(item => ({ workspaceId: item.workspaceId, label: item.label, imageId: item.imageId })) }; return snapshot();
  })));
  ipcMain.handle('connections:container-start', (_event, epoch, id, workspaceId, kind) => reply(() => atEpoch(epoch, async () => {
    if (kind !== undefined && kind !== 'terminal') throw new Error('DESKTOP_CONTAINER_ARGUMENT_INVALID');
    const state = manager.snapshot(), profile = state.profiles.find(profile => profile.id === id);
    if (process.platform !== 'darwin') throw new Error('DESKTOP_CONTAINER_UNSUPPORTED');
    if (id !== state.selectedId || !profile?.identity) throw new Error('STALE_CONNECTION_EPOCH');
    stopObservation(); await observation.whenStopped(); await execution.requireStopped();
    const generation = nativeApprovalGeneration;
    const current = () => generation === nativeApprovalGeneration && manager.snapshot().epoch === epoch && manager.snapshot().selectedId === id;
    if (!visible() || !window.isFocused()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
    const binding = { profileId: id, origin: profile.origin, ...profile.identity };
    const retained = workspaceId === undefined ? undefined : await containerWorkspaces.load(binding, workspaceId);
    const engine = await DesktopContainerEngine.connect(retained?.socketPath, retained?.engineId), imageId = await engine.resolveInstalledImage(retained?.imageId ?? 'node:26.12.1-bookworm-slim');
    if (!current() || !visible() || !window.isFocused()) throw new Error('DESKTOP_OPERATION_CANCELLED');
    const identity = retained ? { workspaceId: retained.workspaceId, ownerId: retained.ownerId } : { workspaceId: randomUUID(), ownerId: randomUUID() };
    container = new DesktopContainerSession(engine, imageId, containerResources, current, { ...identity, existing: Boolean(retained),
      ...(!retained ? { persist: async () => { await containerWorkspaces.create(binding, { socketPath: engine.socketPath, engineId: engine.engineId, imageId, label: 'Docker工作区 ' + new Date().toLocaleString() }, identity); } } : {}) }, kind === 'terminal');
    await container.activate(execution, epoch, id); return snapshot();
  })));
  ipcMain.handle('connections:quit', () => { cancelDesktop(); app.quit(); });
  ipcMain.handle('connections:local', () => { cancelDesktop(); return reply(() => serialize(async () => {
    await execution.requireStopped();
    await shell!.close();
    policy.revoke();
    app.relaunch({ args: process.defaultApp ? [process.argv[1]!] : [] });
    app.quit();
  })); });
  let exiting = false;
  const finishExit = async (close: () => void) => {
    cancelDesktop();
    try { await execution.requireStopped(); exiting = true; close(); }
    catch { if (!window.isDestroyed()) presentation.reveal(window); }
  };
  window.on('close', event => { if (!exiting) { event.preventDefault(); void finishExit(() => window.close()); } });
  app.on('before-quit', event => { if (!exiting) { event.preventDefault(); void finishExit(() => app.quit()); } });
  // No local Gateway, executor or upstream request is started by opening this document.
  await window.loadURL(documentUrl);
}
