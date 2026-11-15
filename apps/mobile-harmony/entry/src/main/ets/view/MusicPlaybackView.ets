import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { generatedMediaTime } from '../common/generatedMedia';
import { generatedMusicPlayback, XopcGeneratedMusicPlayback } from '../service/generatedMusicPlayback';

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
      .linearGradient({ direction: GradientDirection.RightBottom, colors: [
        [this.colors.accentSoft, 0], [this.colors.chat.card, 1]
      ] }).borderRadius(this.colors.corner(24)).clip(true)
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

  @Computed get duration(): number {
    const track = this.music.track;
    return track ? this.music.durationFor(track.conversationId, track.id, track.durationMs) : 0;
  }

  @Computed get canSeek(): boolean {
    return this.duration > 0 && !this.music.loading && !this.music.failed &&
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
      Slider({ value: this.scrub < 0 ? this.music.position : this.scrub, min: 0, max: Math.max(1, this.duration), step: 1 })
        .id('music-progress').width('100%').height(36).trackThickness(4).blockSize({ width: 16, height: 16 })
        .trackColor(this.colors.border).selectedColor(this.colors.chat.action).blockColor(this.colors.chat.action)
        .enabled(this.canSeek)
        .accessibilityText($r('app.string.music_progress'))
        .onChange((value: number, mode: SliderChangeMode): void => {
          if (mode === SliderChangeMode.Begin || mode === SliderChangeMode.Moving) this.scrub = value;
          if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) { this.music.seek(value); this.scrub = -1; }
        })
      Row() {
        Text(generatedMediaTime(this.scrub < 0 ? this.music.position : this.scrub)).fontSize(12).fontColor(this.colors.secondary)
        Text(this.duration > 0 ? generatedMediaTime(this.duration) : '–:–').fontSize(12).fontColor(this.colors.secondary)
      }.width('100%').justifyContent(FlexAlign.SpaceBetween)
      Row({ space: 32 }) {
        this.skipButton(-15)
        XopcMusicPlayButton({ extent: 64, primary: true, buttonId: 'music-player-toggle' })
        this.skipButton(15)
      }.width('100%').justifyContent(FlexAlign.Center).margin({ top: 8 })
    }.width('100%')
  }
}

@ComponentV2
export struct XopcMusicPlayerView {
  @Local music: XopcGeneratedMusicPlayback = generatedMusicPlayback;
  @Local colors: XopcThemeColors = appThemeColors;
  @Local lyricsOpen: boolean = true;
  @Local downloadFailed: boolean = false;

  build() {
    Column() {
      Row() {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(20).fontColor([this.colors.foreground])
        }.id('music-minimize').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.music_minimize')).onClick((): void => { this.music.expanded = false; })
        Text($r('app.string.music_now_playing')).fontSize(14).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.secondary).textAlign(TextAlign.Center).layoutWeight(1)
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(19).fontColor([this.colors.foreground])
        }.id('music-player-close').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.music_close')).onClick((): void => { void this.music.stop(); })
      }.width('100%').constraintSize({ maxWidth: 480 }).padding({ left: 14, right: 14, bottom: 4 })
      if (this.music.track) {
        Row({ space: 12 }) {
          XopcMusicArt({ extent: 52 })
          Column({ space: 3 }) {
            Text(this.music.track.title).fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
              .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(this.music.track.sourceTitle || (this.music.track.versionNumber
              ? $r('app.string.music_version', this.music.track.versionNumber) : $r('app.string.music_audio')))
              .fontSize(13).fontColor(this.colors.secondary).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.message')).fontSize(20).fontColor([this.colors.secondary])
          }.id('music-open-source').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
            .accessibilityText($r('app.string.music_source')).onClick((): void => { this.music.showSource(); })
        }.width('100%').constraintSize({ maxWidth: 480, minHeight: 60 })
          .padding({ left: 24, right: 24, top: 4, bottom: 4 }).backgroundColor(Color.Transparent)
        Scroll() {
          if (this.lyricsOpen && this.music.track.lyrics?.trim()) {
            Text(this.music.track.lyrics).id('music-lyrics-text').width('100%').constraintSize({ maxWidth: 480 })
              .padding({ left: 24, right: 24, top: 20, bottom: 20 })
              .fontSize(20).fontWeight(FontWeight.Medium).lineHeight(36).fontColor(this.colors.foreground)
              .textSelectable(TextSelectableMode.SELECTABLE_UNFOCUSABLE)
          } else {
            Row() { XopcMusicCover() }.width('100%').justifyContent(FlexAlign.Center).padding({ top: 16, bottom: 16 })
          }
        }.id('music-player-content').width('100%').layoutWeight(1)
          .align(this.lyricsOpen && this.music.track.lyrics?.trim() ? Alignment.Top : Alignment.Center).scrollBar(BarState.Off)
        Column() {
          if (this.music.failed || this.downloadFailed) {
            Text(this.music.failed ? $r('app.string.music_retry_hint') : $r('app.string.music_download_failed'))
              .width('100%').fontSize(13).fontColor(this.colors.danger)
          }
          Row({ space: 8 }) {
            Button(this.music.downloading ? $r('app.string.music_loading') : $r('app.string.music_download'))
              .id('music-download').constraintSize({ minHeight: 44 }).padding({ left: 10, right: 10 })
              .fontSize(13).backgroundColor(Color.Transparent).fontColor(this.colors.chat.action)
              .enabled(!this.music.downloading).onClick((): void => {
                this.downloadFailed = false;
                void this.music.download().catch((): void => { this.downloadFailed = true; });
              })
            if (this.music.track.lyrics?.trim()) {
              Button(this.lyricsOpen ? $r('app.string.music_lyrics_close') : $r('app.string.music_lyrics'))
                .id('music-lyrics').constraintSize({ minHeight: 44 }).padding({ left: 10, right: 10 })
                .fontSize(13).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
                .onClick((): void => { this.lyricsOpen = !this.lyricsOpen; })
            }
          }.width('100%').justifyContent(FlexAlign.End)
          XopcMusicProgress()
        }.id('music-player-controls').width('100%').constraintSize({ maxWidth: 480 })
          .padding({ left: 24, right: 24, bottom: 12 })
      } else {
        Column({ space: 12 }) {
          XopcMusicArt({ extent: 72 })
          Text($r('app.string.music_empty')).fontSize(17).fontColor(this.colors.foreground)
          Text($r('app.string.music_empty_hint')).fontSize(14).fontColor(this.colors.secondary)
        }.layoutWeight(1).width('100%').justifyContent(FlexAlign.Center)
      }
    }.id('music-player').width('100%').height('100%')
  }
}
