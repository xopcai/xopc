import { XopcPreviewVideo } from './ChatMediaView';
import { fileIo as fs, fileUri, picker } from '@kit.CoreFileKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { generatedMediaTime } from '../common/generatedMedia';
import { XopcGeneratedMediaCard } from '../model/generatedMedia';
import { downloadGeneratedMedia, removeGeneratedMediaFile } from '../service/generatedMediaFile';
import { XopcGeneratedMusicPlayback } from '../service/generatedMusicPlayback';
import { XopcMusicPlayButton, XopcPreviewHeader } from './MusicPlaybackView';

function mediaTitle(card: XopcGeneratedMediaCard, zh: boolean): string {
  return card.item.title || card.item.summary || (card.kind === 'music' ? (zh ? '音乐' : 'Music')
    : card.draft ? (zh ? '视频草稿' : 'Video draft') : (zh ? '视频' : 'Video'));
}

function mediaStatus(card: XopcGeneratedMediaCard, zh: boolean): string {
  switch (card.item.state) {
    case 'queued':
    case 'submitted': return zh ? '排队中' : 'Queued';
    case 'submitting': return zh ? '提交中' : 'Submitting';
    case 'running':
    case 'saving': return zh ? '生成中' : 'Generating';
    case 'failed': return zh ? '生成失败' : 'Generation failed';
    case 'submission_unknown': return zh ? '提交结果待确认' : 'Submission unconfirmed';
    case 'completed': return zh ? '可播放' : 'Ready to play';
    default: return zh ? '待确认' : 'Review required';
  }
}

@ComponentV2
export struct XopcGeneratedMediaRow {
  @Require @Param card: XopcGeneratedMediaCard;
  @Param submitting: boolean = false;
  @Param confirmationFailed: boolean = false;
  @Param zh: boolean = false;
  @Require @Param music: XopcGeneratedMusicPlayback;
  @Param conversationId: string = '';
  @Local colors: XopcThemeColors = appThemeColors;
  @Event onPlay: () => void = (): void => {};
  @Event onOpen: () => void = (): void => {};
  @Event onMusicAreaChange: () => void = (): void => {};
  @Event onConfirm: () => void = (): void => {};

  @Computed get musicSelected(): boolean {
    return this.card.kind === 'music' && this.music.matches(this.conversationId, this.card.item.id);
  }

  private cardSubtitle(): string {
    const status = mediaStatus(this.card, this.zh);
    if (this.card.kind === 'video') return status;
    const item = this.card.item;
    const parts: string[] = [status];
    if (item.versionNumber) parts.push(this.zh ? '第 ' + item.versionNumber + ' 版' : 'Version ' + item.versionNumber);
    const duration = this.music.durationFor(this.conversationId, item.id, item.durationMs);
    if (duration > 0) parts.push(generatedMediaTime(duration));
    return parts.join(' · ');
  }

  @Builder
  cardLabel() {
    Row({ space: 10 }) {
      Stack() {
        if (this.card.kind === 'music') {
          Text('♫').fontSize(23).fontColor(this.colors.chat.secondary)
        } else {
          SymbolGlyph($r('sys.symbol.film')).fontSize(21).fontColor([this.colors.chat.secondary])
        }
      }.width(42).height(42).borderRadius(this.colors.corner(13)).backgroundColor(this.colors.chat.canvas)
      Column({ space: 3 }) {
        Text(mediaTitle(this.card, this.zh)).fontSize(16).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.foreground).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(this.cardSubtitle()).fontSize(12)
          .fontColor(this.card.item.state === 'completed' ? this.colors.success : this.colors.chat.secondary)
          .maxLines(this.card.kind === 'video' ? 1 : 2).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
    }.width('100%')
  }

  build() {
    Column({ space: 8 }) {
      Row({ space: 10 }) {
        if (this.card.item.state === 'completed') {
          Button({ type: ButtonType.Normal }) { this.cardLabel() }
            .id('generated-' + this.card.kind + '-open-' + this.card.item.id).layoutWeight(1)
            .height(48).padding(0).backgroundColor(Color.Transparent)
            .borderRadius(this.colors.corner(12)).clipShape(this.colors.cornerClip(12))
            .accessibilityText($r('app.string.music_expand', mediaTitle(this.card, this.zh)))
            .onClick((): void => { this.onOpen(); })
        } else {
          Column() { this.cardLabel() }.layoutWeight(1)
        }
        if (this.card.item.state === 'completed') {
          if (this.musicSelected) {
            XopcMusicPlayButton({ primary: true, buttonId: 'generated-media-toggle-' + this.card.item.id })
          } else {
            Button({ type: ButtonType.Circle }) {
              SymbolGlyph($r('sys.symbol.play_fill')).fontSize(17).fontColor([this.colors.chat.action])
            }.id('generated-media-play-' + this.card.item.id).width(44).height(44).padding(0)
              .backgroundColor(this.colors.chat.bubble)
              .accessibilityText($r('app.string.chat_media_play'))
              .onClick((): void => { this.onPlay(); })
          }
        }
      }.width('100%')
      if (this.card.draft) {
        if (this.card.item.estimatedCreditMicro !== undefined) {
          Text(this.zh ? '预估 ' + (this.card.item.estimatedCreditMicro / 1000000).toFixed(2) + ' 积分'
            : 'Estimated ' + (this.card.item.estimatedCreditMicro / 1000000).toFixed(2) + ' credits')
            .fontSize(13).fontColor(this.colors.chat.secondary)
        } else if (this.card.item.estimatedCostFen !== undefined) {
          Text((this.zh ? '预估 ¥' : 'Estimated ¥') + (this.card.item.estimatedCostFen / 100).toFixed(2))
            .fontSize(13).fontColor(this.colors.chat.secondary)
        }
        Button(this.submitting ? (this.zh ? '正在提交' : 'Submitting') : (this.zh ? '确认生成' : 'Generate video'))
          .id('generated-video-confirm-' + this.card.item.id).height(44).fontSize(14)
          .backgroundColor(this.colors.chat.action).fontColor(this.colors.chat.onAction)
          .enabled(this.card.canConfirm && !this.submitting)
          .onClick((): void => { this.onConfirm(); })
        if (!this.card.canConfirm) {
          Text(this.zh ? '请在网关确认视频模型配置后重新准备草稿。' : 'Check the gateway video model and prepare a new draft.')
            .fontSize(13).fontColor(this.colors.chat.secondary)
        }
      }
      if (this.card.item.error || this.confirmationFailed) {
        Text(this.confirmationFailed ? (this.zh ? '提交未完成，请检查当前草稿后重试。' : 'Submission failed. Review the current draft and try again.')
          : this.card.item.error).fontSize(13).fontColor(this.colors.danger)
      }
    }.id('generated-media-card-' + this.card.item.id).width('100%').constraintSize({ maxWidth: 440 })
      .alignItems(HorizontalAlign.Start).padding(16)
      .backgroundColor(this.card.draft && this.card.canConfirm ? this.colors.attentionFill : this.colors.chat.card)
      .borderRadius(this.colors.corner(18))
      .onAreaChange((): void => { if (this.musicSelected) this.onMusicAreaChange(); })
  }
}

@ComponentV2
export struct XopcGeneratedVideoDrawer {
  @Require @Param card: XopcGeneratedMediaCard;
  @Require @Param conversationId: string;
  @Param zh: boolean = false;
  @Event onClose: () => void = (): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local path: string = '';
  @Local loading: boolean = false;
  @Local failed: boolean = false;
  private mounted: boolean = false;
  private request: number = 0;
  private video: VideoController = new VideoController();

  aboutToAppear(): void { this.mounted = true; void this.load(); }
  aboutToDisappear(): void {
    this.mounted = false; this.request++;
    const path = this.path;
    if (path) this.video.stop();
    void removeGeneratedMediaFile(path);
  }

  private async load(): Promise<void> {
    const context = this.getUIContext().getHostContext();
    if (!this.mounted || !context || this.loading) return;
    const request = ++this.request;
    const path = context.cacheDir + '/generated-video-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.mp4';
    this.loading = true; this.failed = false;
    try {
      await downloadGeneratedMedia('video', this.conversationId, this.card.item.id, path,
        (): boolean => request === this.request);
      if (request !== this.request) { await removeGeneratedMediaFile(path); return; }
      this.path = path;
    } catch (_) {
      if (request === this.request) this.failed = true;
    } finally {
      if (request === this.request) this.loading = false;
    }
  }

  private async saveVideo(): Promise<void> {
    const source = this.path;
    const context = this.getUIContext().getHostContext();
    if (!source || !context) return;
    try {
      const name = mediaTitle(this.card, this.zh).replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) || 'video';
      const paths = await new picker.DocumentViewPicker(context).save({ newFileNames: [name + '.mp4'] });
      if (!paths.length || !this.mounted || this.path !== source) return;
      const target = await fs.open(paths[0], fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
      try { await fs.copyFile(source, target.fd); } finally { await fs.close(target); }
    } catch (_) {
      if (this.mounted) {
        this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_media_failed') });
      }
    }
  }

  build() {
    Column() {
      XopcPreviewHeader({ title: mediaTitle(this.card, this.zh), closeId: 'video-player-close', onClose: this.onClose,
        actions: [{ value: $r('app.string.download'), enabled: !!this.path && !this.failed,
          action: (): void => { void this.saveVideo(); } }] })
      Stack() {
        if (this.failed) {
          Column({ space: 8 }) {
            Text(this.zh ? '无法播放这段视频' : 'Unable to play this video').fontColor(this.colors.danger)
            Button($r('app.string.refresh')).height(44).onClick((): void => {
              const path = this.path;
              this.path = '';
              void removeGeneratedMediaFile(path).then((): void => { void this.load(); });
            })
          }
        } else if (this.loading || !this.path) {
          LoadingProgress().width(32).height(32).color(this.colors.chat.action)
        } else {
          this.videoSurface()
        }
      }.width('100%').layoutWeight(1)
    }.id('video-player-drawer').width('100%').height('100%')
      .padding({ top: 12, left: 20, right: 20, bottom: 16 }).alignItems(HorizontalAlign.Center)
  }

  @Builder
  videoSurface() {
    XopcPreviewVideo({ source: fileUri.getUriFromPath(this.path), controller: this.video,
      videoId: 'generated-video-player-' + this.card.item.id, autoplay: true,
      ratio: this.card.item.ratio === '16:9' ? 16 / 9 : this.card.item.ratio === '9:16' ? 9 / 16 : 1,
      onError: (): void => { this.failed = true; } })
  }
}
