import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { generatedMediaTime } from '../common/generatedMedia';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { generatedMusicPlayback, XopcGeneratedMusicPlayback } from '../service/generatedMusicPlayback';

@ComponentV2
export struct XopcMusicArt {
  @Param extent: number = 36;
  @Local colors: XopcThemeColors = appThemeColors;

  build() {
    Stack() {
      Text('♫').fontSize(this.extent * 0.48).fontWeight(FontWeight.Medium).fontColor(this.colors.chat.action)
    }.width(this.extent).height(this.extent).borderRadius(this.extent > 48 ? 28 : 10)
      .backgroundColor(this.colors.accentSoft).accessibilityLevel('no')
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
          .onClick((): void => { this.music.open(); })
        XopcMusicPlayButton({ buttonId: 'music-mini-toggle' })
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(17).fontColor([this.colors.secondary])
        }.id('music-mini-close').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.music_close')).onClick((): void => { void this.music.stop(); })
      }.width('100%').height(56).padding({ right: 3 })
      if (this.progress > 0) {
        Row().width(this.progress + '%').height(2).backgroundColor(this.colors.chat.action).accessibilityLevel('no')
      }
    }.id('music-mini-player').width('calc(100% - 24vp)').height(56).borderRadius(17)
      .backgroundColor(this.colors.chat.card).clip(true)
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

  build() {
    Column() {
      Slider({ value: this.scrub < 0 ? this.music.position : this.scrub, min: 0, max: Math.max(1, this.duration), step: 1 })
        .id('music-progress').width('100%').height(30).selectedColor(this.colors.chat.action).blockColor(this.colors.chat.action)
        .enabled(this.duration > 0 && !this.music.loading && !this.music.failed && this.music.player.state !== 'idle')
        .accessibilityText($r('app.string.music_progress'))
        .onChange((value: number, mode: SliderChangeMode): void => {
          if (mode === SliderChangeMode.Begin || mode === SliderChangeMode.Moving) this.scrub = value;
          if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) { this.music.seek(value); this.scrub = -1; }
        })
      Row() {
        Text(generatedMediaTime(this.scrub < 0 ? this.music.position : this.scrub)).fontSize(12).fontColor(this.colors.secondary)
        Text(this.duration > 0 ? generatedMediaTime(this.duration) : '–:–').fontSize(12).fontColor(this.colors.secondary)
      }.width('100%').justifyContent(FlexAlign.SpaceBetween)
    }.width('100%')
  }
}

@ComponentV2
export struct XopcMusicPlayerView {
  @Local music: XopcGeneratedMusicPlayback = generatedMusicPlayback;
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Local lyricsOpen: boolean = false;
  @Local downloadFailed: boolean = false;

  build() {
    Column() {
      Row() {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(20).fontColor([this.colors.foreground])
        }.id('music-minimize').width(44).height(44).padding(0).backgroundColor(this.colors.chat.card)
          .accessibilityText($r('app.string.music_minimize')).onClick((): void => { this.music.expanded = false; })
        Text($r('app.string.music_now_playing')).fontSize(17).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.foreground).textAlign(TextAlign.Center).layoutWeight(1)
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(19).fontColor([this.colors.foreground])
        }.id('music-player-close').width(44).height(44).padding(0).backgroundColor(this.colors.chat.card)
          .accessibilityText($r('app.string.music_close')).onClick((): void => { void this.music.stop(); })
      }.width('100%').padding({ left: 14, right: 14, top: 10, bottom: 8 })
      if (this.music.track) {
        Scroll() {
          Column({ space: 12 }) {
            Row() { XopcMusicArt({ extent: 208 }) }.width('100%').justifyContent(FlexAlign.Center).margin({ top: 14, bottom: 4 })
            Text(this.music.track?.title ?? '').width('100%').fontSize(28).fontWeight(FontWeight.Bold)
              .fontColor(this.colors.foreground).maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(this.music.track?.versionNumber ? $r('app.string.music_version', this.music.track.versionNumber)
              : $r('app.string.music_audio')).width('100%').fontSize(13).fontColor(this.colors.secondary)
            XopcMusicProgress()
            if (this.music.failed) {
              Text($r('app.string.music_retry_hint')).width('100%').fontColor(this.colors.danger).fontSize(13)
            }
            Row() { XopcMusicPlayButton({ extent: 62, primary: true, buttonId: 'music-player-toggle' }) }
              .width('100%').justifyContent(FlexAlign.Center).margin({ bottom: 4 })
            Button({ type: ButtonType.Normal }) {
              Row({ space: 10 }) {
                SymbolGlyph($r('sys.symbol.message')).fontSize(20).fontColor([this.colors.chat.action])
                Column({ space: 2 }) {
                  Text($r('app.string.music_source')).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
                  Text(this.music.track?.sourceTitle ?? '').fontSize(12).fontColor(this.colors.secondary).maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(16).fontColor([this.colors.secondary])
              }.width('100%').padding(12)
            }.id('music-open-source').width('100%').constraintSize({ minHeight: 56 }).padding(0).borderRadius(14)
              .backgroundColor(this.colors.chat.card)
              .onClick((): void => { this.music.showSource(); })
            Button(this.music.downloading ? $r('app.string.music_loading') : $r('app.string.music_download'))
              .id('music-download').height(44).padding({ left: 0, right: 16 }).backgroundColor(Color.Transparent)
              .fontColor(this.colors.chat.action).enabled(!this.music.downloading).onClick((): void => {
                this.downloadFailed = false;
                void this.music.download().catch((): void => { this.downloadFailed = true; });
              })
            if (this.downloadFailed) {
              Text($r('app.string.music_download_failed')).fontSize(13).fontColor(this.colors.danger)
            }
            if (this.music.track?.lyrics) {
              Button(this.lyricsOpen ? $r('app.string.music_lyrics_close') : $r('app.string.music_lyrics'))
                .id('music-lyrics').height(44).padding({ left: 0, right: 16 }).backgroundColor(Color.Transparent)
                .fontColor(this.colors.foreground).onClick((): void => { this.lyricsOpen = !this.lyricsOpen; })
              if (this.lyricsOpen) {
                Text(this.music.track.lyrics).width('100%').fontSize(15).lineHeight(25)
                  .fontColor(this.colors.secondary).textSelectable(TextSelectableMode.SELECTABLE_UNFOCUSABLE)
              }
            }
          }.width('100%').constraintSize({ maxWidth: 460 }).padding({ left: 24, right: 24, bottom: 18 })
            .alignItems(HorizontalAlign.Start)
        }.width('100%').layoutWeight(1).align(Alignment.Top).scrollBar(BarState.Off)
      } else {
        Column({ space: 12 }) {
          XopcMusicArt({ extent: 72 })
          Text($r('app.string.music_empty')).fontSize(17).fontColor(this.colors.foreground)
          Text($r('app.string.music_empty_hint')).fontSize(14).fontColor(this.colors.secondary)
        }.layoutWeight(1).width('100%').justifyContent(FlexAlign.Center)
      }
    }.id('music-player').width('100%').height('100%').backgroundColor(this.colors.chat.canvas)
      .ignoreLayoutSafeArea([LayoutSafeAreaType.SYSTEM], [LayoutSafeAreaEdge.TOP])
      .padding({ top: this.getUIContext().px2vp(this.layout.systemTopInsetPx) })
  }
}
