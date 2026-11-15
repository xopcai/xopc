import { common, WantAgent, wantAgent } from '@kit.AbilityKit';
import { avSession } from '@kit.AVSessionKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { MUSIC_OPEN_URI, XopcMusicTrack } from '../model/musicPlayback';

export interface XopcMusicSystemCommands {
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
}

export class XopcMusicSystemSession {
  private session?: avSession.AVSession;
  private taskId: number = -1;
  private context?: common.UIAbilityContext;
  private launch?: WantAgent;
  private onCancel?: (info: backgroundTaskManager.ContinuousTaskCancelInfo) => void;
  private metadataKey: string = '';
  private work: Promise<void> = Promise.resolve();
  private revision: number = 0;

  attach(context: common.UIAbilityContext): void { this.context = context; }

  private queue(operation: () => Promise<void>): Promise<void> {
    this.work = this.work.then(operation).catch((error: BusinessError): void => {
      hilog.warn(0x0000, 'XopcMusic', 'System media operation failed (%{public}d)', error.code);
    });
    return this.work;
  }

  prepare(track: XopcMusicTrack, commands: XopcMusicSystemCommands): Promise<void> {
    const revision = this.revision;
    return this.queue(async (): Promise<void> => {
      const context = this.context;
      if (!context || revision !== this.revision) return;
      if (!this.session) {
        const session = await avSession.createAVSession(context, 'xopc-generated-music', 'audio');
        this.session = session;
        session.on('play', (): void => { if (revision === this.revision) commands.play(); });
        session.on('pause', (): void => { if (revision === this.revision) commands.pause(); });
        session.on('stop', (): void => { if (revision === this.revision) commands.stop(); });
        session.on('seek', (milliseconds: number): void => {
          if (revision === this.revision) commands.seek(milliseconds / 1000);
        });
        this.onCancel = (info: backgroundTaskManager.ContinuousTaskCancelInfo): void => {
          if (info.id === this.taskId) {
            this.taskId = -1;
            commands.pause();
          }
        };
        backgroundTaskManager.on('continuousTaskCancel', this.onCancel);
      }
      await this.updateMetadata(track, track.durationMs ?? 0);
      if (!this.launch) {
        this.launch = await wantAgent.getWantAgent({
          wants: [{ bundleName: context.abilityInfo.bundleName, abilityName: context.abilityInfo.name, uri: MUSIC_OPEN_URI }],
          actionType: wantAgent.OperationType.START_ABILITY,
          requestCode: 71, actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
        });
      }
      await this.session.setLaunchAbility(this.launch);
      await this.session.activate();
    });
  }

  suspend(): Promise<void> {
    return this.queue(async (): Promise<void> => { await this.stopTask(this.context); });
  }

  private async updateMetadata(track: XopcMusicTrack, durationMs: number): Promise<void> {
    const key = JSON.stringify([track.conversationId, track.id, durationMs]);
    if (!this.session || key === this.metadataKey) return;
    await this.session.setAVMetadata({
      assetId: track.id, title: track.title, artist: track.sourceTitle || 'xopc', duration: durationMs
    });
    this.metadataKey = key;
  }

  publish(track: XopcMusicTrack, state: string, position: number, duration: number): void {
    const revision = this.revision;
    void this.queue(async (): Promise<void> => {
      if (!this.session || revision !== this.revision) return;
      let playbackState = avSession.PlaybackState.PLAYBACK_STATE_PAUSE;
      if (state === 'playing') playbackState = avSession.PlaybackState.PLAYBACK_STATE_PLAY;
      else if (state === 'completed') playbackState = avSession.PlaybackState.PLAYBACK_STATE_COMPLETED;
      else if (state === 'error') playbackState = avSession.PlaybackState.PLAYBACK_STATE_ERROR;
      else if (state === 'loading') playbackState = avSession.PlaybackState.PLAYBACK_STATE_BUFFERING;
      const playing = state === 'playing';
      await this.updateMetadata(track, duration > 0 ? Math.round(duration * 1000) : track.durationMs ?? 0);
      await this.session.setAVPlaybackState({
        state: playbackState,
        speed: 1,
        position: { elapsedTime: Math.round(position * 1000), updateTime: Date.now() }
      });
      const context = this.context;
      if (playing && this.taskId < 0 && context && this.launch && revision === this.revision) {
        const request = new backgroundTaskManager.ContinuousTaskRequest();
        request.backgroundTaskModes = [backgroundTaskManager.BackgroundTaskMode.MODE_AUDIO_PLAYBACK];
        request.backgroundTaskSubmodes = [backgroundTaskManager.BackgroundTaskSubmode.SUBMODE_NORMAL_NOTIFICATION];
        request.wantAgent = this.launch;
        const result = await backgroundTaskManager.startBackgroundRunning(context, request);
        this.taskId = result.continuousTaskId ?? -1;
      } else if (!playing) {
        await this.stopTask(context);
      }
    });
  }

  private async stopTask(context?: common.UIAbilityContext): Promise<void> {
    const id = this.taskId;
    this.taskId = -1;
    if (context && id >= 0) backgroundTaskManager.stopBackgroundRunning(context, id);
  }

  release(): Promise<void> {
    this.revision++;
    const context = this.context;
    return this.queue(async (): Promise<void> => {
      const session = this.session;
      const onCancel = this.onCancel;
      this.session = undefined;
      this.onCancel = undefined;
      this.launch = undefined;
      this.metadataKey = '';
      try { await this.stopTask(context); }
      finally {
        if (onCancel) {
          try { backgroundTaskManager.off('continuousTaskCancel', onCancel); } catch (_) {}
        }
        await session?.destroy();
      }
    });
  }
}
