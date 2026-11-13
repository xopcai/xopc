import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { generatedMediaTime } from '../common/generatedMedia';
import { XopcGeneratedMediaCard } from '../model/generatedMedia';
import { downloadGeneratedMedia, removeGeneratedMediaFile } from '../service/generatedMediaFile';
import { XopcGeneratedMusicPlayback } from '../service/generatedMusicPlayback';

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
  @Param playbackId: string = '';
  @Require @Param music: XopcGeneratedMusicPlayback;
  @Param conversationId: string = '';
  @Local colors: XopcThemeColors = appThemeColors;
  @Local detailsOpen: boolean = false;
  @Event onPlay: () => void = (): void => {};
  @Event onCloseMusic: () => void = (): void => {};
  @Event onConfirm: () => void = (): void => {};

  @Computed get musicSelected(): boolean { return this.card.kind === 'music' && this.music.songId === this.card.item.id; }
  @Computed get videoSelected(): boolean { return this.card.kind === 'video' && this.playbackId === this.card.item.id; }

  private metadata(): string {
    const item = this.card.item;
    if (this.card.kind === 'music') {
      const parts: string[] = [];
      if (item.versionNumber) parts.push(this.zh ? '第 ' + item.versionNumber + ' 版' : 'Version ' + item.versionNumber);
      if (item.durationMs) parts.push(generatedMediaTime(item.durationMs / 1000));
      return parts.join(' · ');
    }
    return [item.duration === -1 ? (this.zh ? '自动时长' : 'Auto duration')
      : item.duration ? item.duration + (this.zh ? ' 秒' : ' s') : '', item.resolution ?? '',
      item.ratio === 'adaptive' ? '' : item.ratio ?? ''].filter((part: string): boolean => !!part).join(' · ');
  }

  build() {
    Column({ space: 8 }) {
      Row({ space: 10 }) {
        Stack() {
          if (this.card.kind === 'music') {
            Text('♫').fontSize(23).fontColor(this.colors.accent)
          } else {
            SymbolGlyph($r('sys.symbol.film')).fontSize(21).fontColor([this.colors.accent])
          }
        }.width(42).height(42).borderRadius(13).backgroundColor(this.colors.accentSoft)
        Column({ space: 3 }) {
          Text(mediaTitle(this.card, this.zh)).fontSize(16).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text([mediaStatus(this.card, this.zh), this.metadata()].filter((part: string): boolean => !!part).join(' · '))
            .fontSize(12).fontColor(this.colors.secondary).maxLines(2)
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        if (this.card.item.state === 'completed') {
          if (this.musicSelected) {
            XopcGeneratedMusicButton({ music: this.music, zh: this.zh, onAction: this.onPlay })
          } else {
            Button({ type: ButtonType.Circle }) {
              SymbolGlyph(this.videoSelected ? $r('sys.symbol.xmark') : $r('sys.symbol.play_fill')).fontSize(17).fontColor([this.colors.accent])
            }.id('generated-media-play-' + this.card.item.id).width(44).height(44).padding(0)
              .backgroundColor(this.colors.accentSoft)
              .accessibilityText(this.videoSelected ? (this.zh ? '关闭播放' : 'Close player') : (this.zh ? '播放' : 'Play'))
              .onClick((): void => { this.onPlay(); })
          }
        }
      }.width('100%')
      if (this.musicSelected) {
        XopcGeneratedMusicControls({ card: this.card, music: this.music, zh: this.zh, onClose: this.onCloseMusic })
      } else if (this.videoSelected) {
        XopcGeneratedVideoPlayer({ card: this.card, conversationId: this.conversationId, zh: this.zh })
      }
      if (this.card.draft) {
        if (this.card.item.estimatedCreditMicro !== undefined) {
          Text(this.zh ? '预估 ' + (this.card.item.estimatedCreditMicro / 1000000).toFixed(2) + ' 积分'
            : 'Estimated ' + (this.card.item.estimatedCreditMicro / 1000000).toFixed(2) + ' credits')
            .fontSize(13).fontColor(this.colors.secondary)
        } else if (this.card.item.estimatedCostFen !== undefined) {
          Text((this.zh ? '预估 ¥' : 'Estimated ¥') + (this.card.item.estimatedCostFen / 100).toFixed(2))
            .fontSize(13).fontColor(this.colors.secondary)
        }
        Button(this.submitting ? (this.zh ? '正在提交' : 'Submitting') : (this.zh ? '确认生成' : 'Generate video'))
          .id('generated-video-confirm-' + this.card.item.id).height(44).fontSize(14)
          .enabled(this.card.canConfirm && !this.submitting)
          .onClick((): void => { this.onConfirm(); })
        if (!this.card.canConfirm) {
          Text(this.zh ? '请在网关确认视频模型配置后重新准备草稿。' : 'Check the gateway video model and prepare a new draft.')
            .fontSize(13).fontColor(this.colors.secondary)
        }
      }
      if (this.card.item.error || this.confirmationFailed) {
        Text(this.confirmationFailed ? (this.zh ? '提交未完成，请检查当前草稿后重试。' : 'Submission failed. Review the current draft and try again.')
          : this.card.item.error).fontSize(13).fontColor(this.colors.danger)
      }
      if (this.card.item.prompt) {
        Button(this.detailsOpen ? (this.zh ? '收起创作详情' : 'Hide details') : (this.zh ? '创作详情' : 'Details'))
          .height(44).padding({ left: 0, right: 12 }).fontSize(13).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
          .onClick((): void => { this.detailsOpen = !this.detailsOpen; })
        if (this.detailsOpen) {
          Text(this.card.item.prompt).fontSize(14).fontColor(this.colors.secondary).width('100%')
        }
      }
    }.id('generated-media-card-' + this.card.item.id).width('100%').constraintSize({ maxWidth: 440 })
      .alignItems(HorizontalAlign.Start).padding(12).borderRadius(18)
      .backgroundColor(this.colors.grouped)
  }
}

@ComponentV2
struct XopcGeneratedVideoPlayer {
  @Require @Param card: XopcGeneratedMediaCard;
  @Require @Param conversationId: string;
  @Param zh: boolean = false;
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

  build() {
    Column({ space: 6 }) {
      if (this.loading) {
        LoadingProgress().width(32).height(32).color(this.colors.accent)
      } else if (this.failed) {
        Text(this.zh ? '无法播放这段视频' : 'Unable to play this video').fontColor(this.colors.danger)
        Button($r('app.string.refresh')).height(44).onClick((): void => {
          const path = this.path;
          this.path = '';
          void removeGeneratedMediaFile(path).then((): void => { void this.load(); });
        })
      } else if (this.path) {
        Video({ src: this.path, controller: this.video }).width('100%')
          .aspectRatio(this.card.item.ratio === '9:16' ? 1 : 16 / 9)
          .autoPlay(true).controls(true).objectFit(ImageFit.Contain).borderRadius(12)
          .onError((): void => { this.failed = true; })
      }
    }.id('generated-media-inline-' + this.card.item.id).width('100%').alignItems(HorizontalAlign.Start)
  }
}

@ComponentV2
struct XopcGeneratedMusicButton {
  @Require @Param music: XopcGeneratedMusicPlayback;
  @Param zh: boolean = false;
  @Local colors: XopcThemeColors = appThemeColors;
  @Event onAction: () => void = (): void => {};

  build() {
    Button({ type: ButtonType.Circle }) {
      if (this.music.loading || ['loading', 'initialized'].includes(this.music.player.state)) {
        LoadingProgress().width(20).height(20).color(this.colors.accent)
      } else if (this.music.failed || this.music.player.state === 'error') {
        Text('↻').fontSize(21).fontColor(this.colors.accent)
      } else {
        SymbolGlyph(this.music.player.state === 'playing' ? $r('sys.symbol.pause_fill') : $r('sys.symbol.play_fill'))
          .fontSize(17).fontColor([this.colors.accent])
      }
    }.id('generated-media-toggle-' + this.music.songId).width(44).height(44).padding(0)
      .backgroundColor(this.colors.accentSoft)
      .enabled(!this.music.loading && !['loading', 'initialized'].includes(this.music.player.state))
      .accessibilityText(this.music.failed || this.music.player.state === 'error' ? (this.zh ? '重试' : 'Retry')
        : this.music.player.state === 'playing' ? (this.zh ? '暂停' : 'Pause') : (this.zh ? '播放' : 'Play'))
      .onClick((): void => { this.onAction(); })
  }
}

@ComponentV2
struct XopcGeneratedMusicControls {
  @Require @Param card: XopcGeneratedMediaCard;
  @Require @Param music: XopcGeneratedMusicPlayback;
  @Param zh: boolean = false;
  @Local colors: XopcThemeColors = appThemeColors;
  @Local lyricsOpen: boolean = false;
  @Local scrubPosition: number = -1;
  @Event onClose: () => void = (): void => {};

  @Computed get displayPosition(): number {
    return this.scrubPosition >= 0 ? this.scrubPosition : this.music.player.position;
  }

  build() {
    Column({ space: 4 }) {
      if (this.music.failed || this.music.player.state === 'error') {
        Text(this.zh ? '无法播放这首歌，点击重试。' : 'Unable to play this song. Tap to retry.')
          .fontSize(13).fontColor(this.colors.danger)
      } else {
        Slider({ value: this.displayPosition, min: 0, max: Math.max(1, this.music.player.duration), step: 1 })
          .width('100%').enabled(this.music.player.duration > 0)
          .accessibilityText(this.zh ? '播放进度' : 'Playback progress')
          .onChange((position: number, mode: SliderChangeMode): void => {
            if (mode === SliderChangeMode.Begin || mode === SliderChangeMode.Moving) this.scrubPosition = position;
            if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) {
              this.music.player.seek(position);
              this.scrubPosition = -1;
            }
          })
        Row() {
          Text(generatedMediaTime(this.displayPosition)).fontSize(13).fontColor(this.colors.secondary)
          Text(generatedMediaTime(this.music.player.duration || (this.card.item.durationMs ?? 0) / 1000))
            .fontSize(13).fontColor(this.colors.secondary)
        }.justifyContent(FlexAlign.SpaceBetween).width('100%')
      }
      Row() {
        if (this.card.item.lyrics) {
          Button(this.lyricsOpen ? (this.zh ? '收起歌词' : 'Hide lyrics') : (this.zh ? '歌词' : 'Lyrics'))
            .height(44).backgroundColor(this.colors.accentSoft).fontColor(this.colors.accent)
            .onClick((): void => { this.lyricsOpen = !this.lyricsOpen; })
        }
        Blank()
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(16).fontColor([this.colors.secondary])
        }.width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText(this.zh ? '关闭播放' : 'Close player')
          .onClick((): void => { this.onClose(); })
      }.width('100%')
      if (this.lyricsOpen && this.card.item.lyrics) {
        Text(this.card.item.lyrics).width('100%').fontSize(16).lineHeight(26)
          .fontColor(this.colors.foreground).textSelectable(TextSelectableMode.SELECTABLE_UNFOCUSABLE)
      }
    }.id('generated-media-inline-' + this.card.item.id).width('100%').alignItems(HorizontalAlign.Start)
  }
}
