import { attachDevicePersonalTools, cancelAllDevicePersonalTools, cancelForegroundDevicePersonalTools, hasActivePersonalPicker } from '../service/devicePersonalTools';
import { attachDeviceLocation, cancelAllDeviceLocations, hasActiveDeviceLocationPermissionRequest } from '../service/deviceLocation';
import { Configuration, UIAbility, Want } from '@kit.AbilityKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { KeyboardAvoidMode, window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { realtimeClient } from '../service/realtimeClient';
import { gatewaySession } from '../service/gatewaySession';
import { appSettings } from '../service/settings';
import { voiceCapture } from '../service/voiceCapture';
import { pushNotifications } from '../service/pushNotifications';
import { notificationNavigation } from '../service/notificationNavigation';
import { layoutState } from '../service/layoutState';
import { chatReadAloud } from '../service/chatReadAloud';
import { XopcIncomingShareAttachment } from '../model/share';
import { decodeShareHandoff, shareIntake, SHARE_INTAKE_URI } from '../service/shareIntake';
import { voiceCall } from '../service/voiceCall';
import { localSessionStore } from '../service/localSessionStore';
import { generatedMusicPlayback } from '../service/generatedMusicPlayback';
import { assistantAudioAutoplay } from '../service/assistantAudioAutoplay';
import { discussionCapture } from '../service/discussionCapture';
import { MUSIC_OPEN_URI } from '../model/musicPlayback';

export default class EntryAbility extends UIAbility {
  private mainWindow?: window.Window;
  private suspendDelayId: number = -1;
  private suspendFallbackTimer: number = -1;
  private cancelSuspendDelay(): void {
    clearTimeout(this.suspendFallbackTimer);
    this.suspendFallbackTimer = -1;
    if (this.suspendDelayId >= 0) {
      const id = this.suspendDelayId;
      this.suspendDelayId = -1;
      try { backgroundTaskManager.cancelSuspendDelay(id); }
      catch (_error) { hilog.warn(0x0000, 'XopcApp', 'Cancel suspend delay failed'); }
    }
  }
  private onAvoidArea = (data: window.AvoidAreaOptions): void => {
    if (data.type === window.AvoidAreaType.TYPE_SYSTEM) {
      layoutState.systemTopInsetPx = data.area.topRect.height;
      layoutState.systemBottomInsetPx = data.area.bottomRect.height;
    } else if (data.type === window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR) {
      layoutState.systemBottomInsetPx = data.area.bottomRect.height;
    } else if (data.type === window.AvoidAreaType.TYPE_KEYBOARD) {
      layoutState.keyboardHeightPx = data.area.bottomRect.height;
    }
  };
  private onKeyboardHeightChange = (height: number): void => {
    layoutState.keyboardHeightPx = Math.max(0, height);
  };
  onWindowStageDestroy(): void {
    cancelAllDeviceLocations(); cancelAllDevicePersonalTools();
    appSettings.onColorModeChanged = undefined;
    try { this.mainWindow?.off('avoidAreaChange', this.onAvoidArea); }
    catch (_error) { hilog.warn(0x0000, 'XopcApp', 'Window listener cleanup failed'); }
    try { this.mainWindow?.off('keyboardHeightChange', this.onKeyboardHeightChange); }
    catch (_error) { hilog.warn(0x0000, 'XopcApp', 'Keyboard listener cleanup failed'); }
    this.mainWindow = undefined;
    layoutState.systemTopInsetPx = 0;
    layoutState.systemBottomInsetPx = 0;
    layoutState.keyboardHeightPx = 0;
    layoutState.bottomChromeInset = 0;
  }
  private receiveWant(want: Want): void {
    if (want.uri === MUSIC_OPEN_URI) {
      generatedMusicPlayback.requestOpen(); return;
    }
    if (want.action === 'ohos.want.action.viewData' && want.uri?.startsWith('file://')) {
      void shareIntake.receiveFile(this.context.filesDir, want.uri); return;
    }
    if (want.uri === SHARE_INTAKE_URI) {
      const payload = want.parameters?.xopcSharePayload;
      if (typeof payload === 'string') {
        const shared = decodeShareHandoff(payload);
        if (shared && (shared.attachments ?? []).every((file: XopcIncomingShareAttachment): boolean => file.path.startsWith(this.context.filesDir + '/share-'))) shareIntake.receive(shared);
      }
      return;
    }
    if (want.uri) notificationNavigation.receive(want.uri);
  }
  onCreate(want: Want): void {
    generatedMusicPlayback.attach(this.context, async (): Promise<boolean> => {
      if (voiceCall.phase !== 'idle' || voiceCapture.state !== 'idle' || discussionCapture.active) return false;
      await Promise.all([chatReadAloud.stop(), assistantAudioAutoplay.interrupt()]);
      return voiceCall.phase === 'idle' && voiceCapture.state === 'idle' && !discussionCapture.active;
    });
    this.receiveWant(want);
  }
  onNewWant(want: Want): void { this.receiveWant(want); }
  onConfigurationUpdate(configuration: Configuration): void { appSettings.syncSystemColorMode(configuration.colorMode); }
  onForeground(): void {
    this.cancelSuspendDelay();
    gatewaySession.setForeground(true);
    layoutState.foreground = true;
    generatedMusicPlayback.onForeground();
    voiceCall.onForeground();
    if (gatewaySession.currentProfile()) realtimeClient.onAppForegroundChanged(true);
    pushNotifications.restore();
    notificationNavigation.flush();
  }
  onBackground(): void {
    generatedMusicPlayback.checkpoint();
    const locationPermission: boolean = hasActiveDeviceLocationPermissionRequest();
    const personalInteraction: boolean = hasActivePersonalPicker();
    if (!locationPermission) cancelAllDeviceLocations();
    if (!personalInteraction) cancelForegroundDevicePersonalTools();
    layoutState.foreground = false;
    gatewaySession.setForeground(false);
    voiceCall.onBackground();
    realtimeClient.onAppForegroundChanged(false);
    this.cancelSuspendDelay();
    if (!personalInteraction && !locationPermission && gatewaySession.currentProfile()) {
      try {
        const info: backgroundTaskManager.DelaySuspendInfo = backgroundTaskManager.requestSuspendDelay(
          'xopc_realtime_keepalive',
          (): void => {
            this.cancelSuspendDelay();
            if (!layoutState.foreground && !hasActivePersonalPicker() && !hasActiveDeviceLocationPermissionRequest()) {
              realtimeClient.suspendForBackground();
            }
          }
        );
        this.suspendDelayId = info.requestId;
        hilog.info(0x0000, 'XopcApp', 'Requested suspend delay: id=%{public}d remainingMs=%{public}d', info.requestId, info.actualDelayTime);
      } catch (_error) {
        hilog.warn(0x0000, 'XopcApp', 'Suspend delay unavailable, falling back to grace timer');
        this.suspendFallbackTimer = setTimeout((): void => {
          this.suspendFallbackTimer = -1;
          if (!layoutState.foreground && !hasActivePersonalPicker() && !hasActiveDeviceLocationPermissionRequest()) {
            realtimeClient.suspendForBackground();
          }
        }, 20000);
      }
    }
    voiceCapture.cancel();
    chatReadAloud.leaveForeground();
  }
  onDestroy(): void {
    this.cancelSuspendDelay();
    void generatedMusicPlayback.shutdown();
    voiceCall.end(); realtimeClient.reset(); voiceCapture.cancel(); chatReadAloud.stop();
  }
  onWindowStageCreate(stage: window.WindowStage): void {
    this.restoreAndLoad(stage);
  }
  private updateStatusBar(dark: boolean): void {
    void this.mainWindow?.setWindowSystemBarProperties({
      statusBarColor: '#00000000',
      statusBarContentColor: dark ? '#FFFFFFFF' : '#FF1B1B1F',
    }).catch((): void => { hilog.warn(0x0000, 'XopcApp', 'Status bar color update failed'); });
  }
  private async restoreAndLoad(stage: window.WindowStage): Promise<void> {
    await localSessionStore.initialize(this.context);
    await shareIntake.initialize(this.context.filesDir).catch((error: Error): void => { hilog.warn(0x0000, 'XopcShare', 'Share recovery failed: %{public}s', error.message); });
    try { await appSettings.restore(this.context); }
    catch (_error) { hilog.warn(0x0000, 'XopcApp', 'Preferences could not be restored'); }
    stage.loadContent('pages/Index', (error: BusinessError): void => {
      if (error.code) {
        hilog.error(0x0000, 'XopcApp', 'Window load failed: %{public}d', error.code);
      } else {
        try {
          this.mainWindow = stage.getMainWindowSync();
          attachDeviceLocation(this.context, this.mainWindow.getUIContext());
          attachDevicePersonalTools(this.context, this.mainWindow.getUIContext());
          this.mainWindow.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
          this.mainWindow.on('avoidAreaChange', this.onAvoidArea);
          this.mainWindow.on('keyboardHeightChange', this.onKeyboardHeightChange);
          layoutState.systemTopInsetPx = this.mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM).topRect.height;
          layoutState.systemBottomInsetPx = this.mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR).bottomRect.height;
          layoutState.keyboardHeightPx = this.mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_KEYBOARD).bottomRect.height;
          appSettings.onColorModeChanged = (dark: boolean): void => { this.updateStatusBar(dark); };
          this.updateStatusBar(appSettings.isDark(this.context));
        } catch (_error) { hilog.warn(0x0000, 'XopcApp', 'Keyboard layout initialization failed'); }
        pushNotifications.onWindowReady();
      }
    });
  }
}
