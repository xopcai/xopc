import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcMusicTrack } from '../model/musicPlayback';
import { generatedMediaTime } from '../common/generatedMedia';
import { generatedMusicPlayback, XopcGeneratedMusicPlayback } from '../service/generatedMusicPlayback';

@ComponentV2
export struct XopcPreviewHeader {
  @Param title: string = '';
  @Param closeId: string = 'preview-close';
  @Param actions: MenuElement[] = [];
  @Event onClose: () => void = (): void => {};
  @Local colors: XopcThemeColors = appThemeColors;

  build() {
    Row({ space: 8 }) {
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.xmark')).fontSize(20).fontColor([this.colors.foreground])
      }.id(this.closeId).width(44).height(44).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.chat_close')).onClick((): void => { this.onClose(); })
      Text(this.title).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
        .layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).textAlign(TextAlign.Center)
      if (this.actions.length) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.ellipsis_circle')).fontSize(20).fontColor([this.colors.foreground])
        }.width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.more')).bindMenu(this.actions)
      } else {
        Blank().width(44)
      }
    }.width('100%').padding({ left: 12, right: 12, top: 4, bottom: 4 })
  }
}

@ComponentV2
export struct XopcMusicArt {
  @Param extent: number = 36;
  @Local colors: XopcThemeColors = appThemeColors;

  build() {
    Stack() {
      Text('♫').fontSize(this.extent * 0.48).fontWeight(FontWeight.Medium).fontColor(this.colors.chat.action)
    }.width(this.extent).height(this.extent).borderRadius(this.colors.corner(this.extent > 48 ? 20 : 10))
      .backgroundColor(this.colors.accentSoft).accessibilityLevel('no')
  }
}

@ComponentV2
struct XopcMusicCover {
  @Local colors: XopcThemeColors = appThemeColors;

  build() {
    Stack() {
      Row().width('74%').aspectRatio(1).borderRadius(999).backgroundColor(this.colors.input).opacity(0.5)
      Row().width('56%').aspectRatio(1).borderRadius(999).backgroundColor(this.colors.chat.bubble)
      Row().width('39%').aspectRatio(1).borderRadius(999).backgroundColor(this.colors.chat.canvas)
      Text('♫').fontSize(46).fontWeight(FontWeight.Medium).fontColor(this.colors.chat.action)
    }.width('80%').constraintSize({ maxWidth: 248 }).aspectRatio(1)
      .backgroundColor(this.colors.chat.card).borderRadius(this.colors.corner(24)).clip(true)
      .accessibilityLevel('no')
  }
}

@ComponentV2
export struct XopcMusicPlayButton {
  @Param extent: number = 44;
  @Param primary: boolean = false;
  @Param buttonId: string = 'music-toggle';
  @Local music: XopcGeneratedMusicPlayback = generatedMusicPlayback;
  @Local colors: XopcThemeColors = appThemeColors;

  build() {
    Button({ type: ButtonType.Circle }) {
      if (this.music.loading) {
        LoadingProgress().width(18).height(18).color(this.primary ? this.colors.chat.onAction : this.colors.chat.action)
      } else {
        SymbolGlyph(this.music.failed ? $r('sys.symbol.arrow_clockwise')
          : this.music.player.state === 'playing' ? $r('sys.symbol.pause_fill') : $r('sys.symbol.play_fill'))
          .fontSize(this.extent > 44 ? 26 : 18)
          .fontColor([this.primary ? this.colors.chat.onAction : this.colors.chat.action])
      }
    }.id(this.buttonId).width(this.extent).height(this.extent).padding(0)
      .backgroundColor(this.primary ? this.colors.chat.action : Color.Transparent)
      .accessibilityText(this.music.loading ? $r('app.string.music_loading') : this.music.failed ? $r('app.string.music_retry')
        : this.music.player.state === 'playing' ? $r('app.string.pause') : $r('app.string.chat_media_play'))
      .enabled(!this.music.loading).onClick((): void => { void this.music.toggle(); })
  }
}

@ComponentV2
export struct XopcMusicMiniPlayer {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local music: XopcGeneratedMusicPlayback = generatedMusicPlayback;
  @Event onOpen: () => void = (): void => {};
  @Param sticky: boolean = false;

  @Computed get progress(): number {
    const track = this.music.track;
    const duration = track ? this.music.durationFor(track.conversationId, track.id, track.durationMs) : 0;
    return duration > 0 ? Math.min(100, this.music.position * 100 / duration) : 0;
  }

  build() {
    Stack({ alignContent: Alignment.BottomStart }) {
      Row({ space: 2 }) {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 8 }) {
            XopcMusicArt()
            Column({ space: 2 }) {
              Text(this.music.track?.title ?? '').width('100%').fontSize(14).fontWeight(FontWeight.Medium)
                .fontColor(this.colors.foreground).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(this.music.failed ? $r('app.string.music_interrupted')
                : this.music.loading ? $r('app.string.music_loading')
                : this.music.player.state === 'playing' ? $r('app.string.music_playing')
                : this.music.player.state === 'completed' ? $r('app.string.music_completed') : $r('app.string.music_paused'))
                .width('100%').fontSize(12).fontColor(this.colors.secondary).maxLines(1)
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          }.width('100%')
        }.id('music-expand').layoutWeight(1).height(48).padding({ left: 6, right: 4 })
          .borderRadius(this.colors.corner(12)).clipShape(this.colors.cornerClip(12))
          .backgroundColor(Color.Transparent).accessibilityText($r('app.string.music_expand', this.music.track?.title ?? ''))
          .onClick((): void => { this.onOpen(); this.music.open(); })
        XopcMusicPlayButton({ buttonId: 'music-mini-toggle' })
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(17).fontColor([this.colors.secondary])
        }.id('music-mini-close').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.music_close')).onClick((): void => { void this.music.stop(); })
      }.width('100%').height(56).padding({ right: 3 })
      if (this.progress > 0) {
        Row().width(this.progress + '%').height(2).backgroundColor(this.colors.chat.action).accessibilityLevel('no')
      }
    }.id(this.sticky ? 'music-sticky-player' : 'music-mini-player').width('calc(100% - 24vp)').height(56)
      .backgroundColor(this.colors.chat.card).borderRadius(this.colors.corner(17)).clip(true)
  }
}

@ComponentV2
export struct XopcMusicProgress {
  @Local music: XopcGeneratedMusicPlayback = generatedMusicPlayback;
  @Local colors: XopcThemeColors = appThemeColors;
  @Local scrub: number = -1;
  @Require @Param track: XopcMusicTrack;
  @Event onPlay: () => void = (): void => {};

  @Computed get current(): boolean {
    return this.music.matches(this.track.conversationId, this.track.id);
  }

  @Computed get playbackPosition(): number { return this.current ? this.music.position : 0; }

  @Computed get duration(): number {
    return this.music.durationFor(this.track.conversationId, this.track.id, this.track.durationMs);
  }

  @Computed get canSeek(): boolean {
    return this.current && this.duration > 0 && !this.music.loading && !this.music.failed &&
      ['playing', 'paused', 'prepared', 'completed'].includes(this.music.player.state);
  }

  @Builder
  skipButton(delta: number) {
    Button(delta < 0 ? '−15' : '+15')
      .id(delta < 0 ? 'music-skip-back' : 'music-skip-forward').width(48).height(48).padding(0)
      .fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
      .backgroundColor(this.colors.grouped).enabled(this.canSeek)
      .accessibilityText(delta < 0 ? $r('app.string.music_skip_back') : $r('app.string.music_skip_forward'))
      .onClick((): void => { this.music.seek(Math.min(this.duration, Math.max(0, this.music.position + delta))); })
  }

  build() {
    Column({ space: 4 }) {
      Slider({ value: this.scrub < 0 ? this.playbackPosition : this.scrub, min: 0, max: Math.max(1, this.duration), step: 1 })
        .id('music-progress').width('100%').height(36).trackThickness(4).blockSize({ width: 16, height: 16 })
        .trackColor(this.colors.border).selectedColor(this.colors.chat.action).blockColor(this.colors.chat.action)
        .enabled(this.canSeek)
        .accessibilityText($r('app.string.music_progress'))
        .onChange((value: number, mode: SliderChangeMode): void => {
          if (mode === SliderChangeMode.Begin || mode === SliderChangeMode.Moving) this.scrub = value;
          if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) { this.music.seek(value); this.scrub = -1; }
        })
      Row() {
        Text(generatedMediaTime(this.scrub < 0 ? this.playbackPosition : this.scrub)).fontSize(12).fontColor(this.colors.secondary)
        Text(this.duration > 0 ? generatedMediaTime(this.duration) : '–:–').fontSize(12).fontColor(this.colors.secondary)
      }.width('100%').justifyContent(FlexAlign.SpaceBetween)
      Row({ space: 32 }) {
        this.skipButton(-15)
        if (this.current) {
          XopcMusicPlayButton({ extent: 64, primary: true, buttonId: 'music-player-toggle' })
        } else {
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.play_fill')).fontSize(26).fontColor([this.colors.chat.onAction])
          }.id('music-player-toggle').width(64).height(64).padding(0).backgroundColor(this.colors.chat.action)
            .accessibilityText($r('app.string.chat_media_play')).onClick((): void => { this.onPlay(); })
        }
        this.skipButton(15)
      }.width('100%').justifyContent(FlexAlign.Center).margin({ top: 8 })
    }.width('100%')
  }
}

interface XopcTimedLyric { seconds: number; text: string; }

function timedLyrics(lyrics: string): XopcTimedLyric[] {
  const result: XopcTimedLyric[] = [];
  for (const line of lyrics.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^\[(\d+):(\d{2})(?:[.](\d{1,3}))?](.*)$/.exec(line.trim());
    if (!match || Number(match[2]) >= 60) return [];
    const seconds = Number(match[1]) * 60 + Number(match[2]) + Number('0.' + (match[3] ?? '0'));
    if (!Number.isFinite(seconds)) return [];
    result.push({ seconds, text: match[4].trim() });
  }
  return result.sort((a: XopcTimedLyric, b: XopcTimedLyric): number => a.seconds - b.seconds);
}

@ComponentV2
export struct XopcMusicPreviewContent {
  @Require @Param track: XopcMusicTrack;
  @Local music: XopcGeneratedMusicPlayback = generatedMusicPlayback;
  @Local colors: XopcThemeColors = appThemeColors;
  @Local lyricsOpen: boolean = false;

  @Monitor('track.id', 'track.conversationId')
  resetLyrics(): void { this.lyricsOpen = false; }

  @Computed get timed(): XopcTimedLyric[] { return timedLyrics(this.track.lyrics ?? ''); }

  @Computed get current(): boolean { return this.music.matches(this.track.conversationId, this.track.id); }

  @Computed get activeLine(): number {
    if (!this.current) return -1;
    let active = -1;
    for (let index = 0; index < this.timed.length && this.timed[index].seconds <= this.music.position; index++) {
      active = index;
    }
    return active;
  }

  build() {
    Column({ space: 8 }) {
      Scroll() {
        if (this.lyricsOpen && this.timed.length) {
          Column({ space: 12 }) {
            ForEach(this.timed, (line: XopcTimedLyric, index: number): void => {
              Button({ type: ButtonType.Normal }) {
                Text(line.text).width('100%').textAlign(TextAlign.Start).fontSize(20)
                  .fontColor(index === this.activeLine ? this.colors.chat.action : this.colors.foreground)
              }.width('100%').constraintSize({ minHeight: 44 }).backgroundColor(Color.Transparent)
                .enabled(this.current && ['playing', 'paused', 'prepared', 'completed'].includes(this.music.player.state))
                .onClick((): void => { this.music.seek(line.seconds); })
            }, (line: XopcTimedLyric, index: number): string => line.seconds.toString() + ':' + index.toString())
          }.id('music-lyrics-text').width('100%').constraintSize({ maxWidth: 480 }).padding(16)
        } else if (this.lyricsOpen && this.track.lyrics?.trim()) {
          Text(this.track.lyrics).id('music-lyrics-text').width('100%').constraintSize({ maxWidth: 480 })
            .padding({ left: 24, right: 24, top: 16, bottom: 16 })
            .fontSize(20).fontWeight(FontWeight.Medium).lineHeight(36).fontColor(this.colors.foreground)
            .textSelectable(TextSelectableMode.SELECTABLE_UNFOCUSABLE)
        } else {
          Row() { XopcMusicCover() }.width('100%').justifyContent(FlexAlign.Center).padding({ top: 8, bottom: 8 })
        }
      }.id('music-player-content').width('100%').layoutWeight(1)
        .align(this.lyricsOpen ? Alignment.Top : Alignment.Center).scrollBar(BarState.Off)
      Column({ space: 4 }) {
        if (this.music.matches(this.track.conversationId, this.track.id) && this.music.failed) {
          Text($r('app.string.music_retry_hint')).fontSize(13).fontColor(this.colors.danger)
        }
        if (this.track.lyrics?.trim()) {
          Button(this.lyricsOpen ? $r('app.string.music_lyrics_close') : $r('app.string.music_lyrics'))
            .id('music-lyrics').height(44).padding({ left: 10, right: 10 })
            .fontSize(13).backgroundColor(Color.Transparent).fontColor(this.colors.chat.action)
            .onClick((): void => { this.lyricsOpen = !this.lyricsOpen; })
        }
        XopcMusicProgress({ track: this.track, onPlay: (): void => {
          const context = this.getUIContext().getHostContext();
          if (context) void this.music.play(context.cacheDir, this.track);
        } })
      }.id('music-player-controls').width('100%').constraintSize({ maxWidth: 480 })
        .padding({ left: 24, right: 24, bottom: 12 })
    }.width('100%').height('100%')
  }
}

@ComponentV2
export struct XopcMusicPlayerView {
  @Local music: XopcGeneratedMusicPlayback = generatedMusicPlayback;
  @Local colors: XopcThemeColors = appThemeColors;
  @Local downloadFailed: boolean = false;

  @Computed get track(): XopcMusicTrack | undefined { return this.music.previewTrack ?? this.music.track; }

  private actions(track: XopcMusicTrack): MenuElement[] {
    const actions: MenuElement[] = [{ value: $r('app.string.music_download'), enabled: !this.music.downloading,
      action: (): void => {
        this.downloadFailed = false;
        void this.music.download(track).catch((): void => { this.downloadFailed = true; });
      } }];
    if (this.music.matches(track.conversationId, track.id)) {
      if (track.conversationId && !this.music.previewTrack) {
        actions.push({ value: $r('app.string.music_source'), action: (): void => { this.music.showSource(); } });
      }
      actions.push({ value: $r('app.string.music_close'), action: (): void => { void this.music.stop(); } });
    }
    return actions;
  }

  build() {
    Column() {
      if (this.track) {
        XopcPreviewHeader({ title: this.track.title, closeId: 'music-player-close', actions: this.actions(this.track),
          onClose: (): void => { this.music.closePreview(); } })
        if (this.downloadFailed) {
          Text($r('app.string.music_download_failed')).fontSize(13).fontColor(this.colors.danger)
        }
        Column() { XopcMusicPreviewContent({ track: this.track }) }.width('100%').layoutWeight(1)
      } else {
        XopcPreviewHeader({ onClose: (): void => { this.music.closePreview(); } })
        Text($r('app.string.music_empty')).fontSize(17).fontColor(this.colors.foreground)
          .width('100%').layoutWeight(1).textAlign(TextAlign.Center)
      }
    }.id('music-player').width('100%').height('100%')
  }
}
