import { XopcClarificationCard } from './ClarificationCard';
import { XopcClarificationCommand } from '../model/clarification';
import { appThemeColors, xopcRoundedClip, XopcThemeColors } from '../common/themePalette';
import { XopcVoiceCall } from '../service/voiceCall';
import { userErrorMessage } from '../common/userError';
import { XopcFloatingAudioCard, XopcFloatingAudioPosition } from './FloatingAudioCard';

interface XopcVoiceCallControl {
  label: Resource;
  symbol: Resource;
  controlId: string;
  active: boolean;
  available: boolean;
  action: () => void;
}

@ComponentV2
export struct XopcVoiceCallView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Require @Param call: XopcVoiceCall;
  @Param viewportWidth: number = 0;
  @Param viewportHeight: number = 0;
  @Local miniPosition: XopcFloatingAudioPosition = new XopcFloatingAudioPosition();
  @Local now: number = Date.now();
  private timer: number = -1;

  aboutToAppear(): void { this.timer = setInterval((): void => { this.now = Date.now(); }, 1000); }
  aboutToDisappear(): void { clearInterval(this.timer); this.timer = -1; }

  private elapsed(): string {
    const seconds = Math.max(0, Math.floor((this.now - this.call.startedAt) / 1000));
    return Math.floor(seconds / 60).toString() + ':' + (seconds % 60 < 10 ? '0' : '') + (seconds % 60).toString();
  }

  private status(): Resource {
    if (this.call.muted) return $r('app.string.voice_call_muted');
    if (this.call.phase === 'connecting') return $r('app.string.voice_call_connecting');
    if (this.call.phase === 'recovering') return $r('app.string.voice_call_recovering');
    if (this.call.phase === 'paused') return $r('app.string.voice_call_paused');
    if (this.call.responseStage === 'speaking') return $r('app.string.voice_call_speaking');
    if (this.call.activity) return $r('app.string.voice_call_working');
    if (this.call.responseId) return $r('app.string.voice_call_thinking');
    return $r('app.string.voice_call_listening');
  }

  private errorMessage(): ResourceStr {
    if (this.call.error === 'NO_RESPONSE_AUDIO') return $r('app.string.voice_call_text_only');
    if (this.call.phase === 'connected') {
      if (['INPUT_DROPPED', 'INPUT_BACKPRESSURE', 'EMPTY_UTTERANCE'].includes(this.call.error)) {
        return $r('app.string.voice_call_repeat_input');
      }
      if (this.call.error === 'RESPONSE_FAILED') return $r('app.string.voice_call_reply_interrupted');
      if (this.call.error === 'ROUTE_CHANGE_FAILED') return $r('app.string.voice_call_route_failed');
    }
    return userErrorMessage(this.call.error, 'generic');
  }

  @Builder
  control($$: XopcVoiceCallControl) {
    Column({ space: 7 }) {
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($$.symbol).fontSize(24).fontColor([$$.active ? this.colors.surface : this.colors.foreground])
      }.id($$.controlId).width(54).height(54).padding(0)
        .backgroundColor($$.active ? this.colors.foreground : this.colors.input)
        .enabled($$.available).accessibilityText($$.label).accessibilitySelected($$.active)
        .onClick((): void => { $$.action(); })
      Text($$.label).fontSize(12).fontColor($$.active ? this.colors.foreground : this.colors.secondary)
        .fontWeight($$.active ? FontWeight.Medium : FontWeight.Regular)
    }.width(78)
  }

  @Builder
  intervention() {
    if (this.call.clarification) {
      XopcClarificationCard({ prompt: this.call.clarification, submitting: this.call.clarificationBusy, errorMessage: this.call.error,
        onRespond: (command: XopcClarificationCommand): void => { this.call.submitClarification(command); } })
    } else if (this.call.approval) {
      Column({ space: 10 }) {
        Text($r('app.string.voice_call_approval')).fontSize(13).fontColor(this.colors.attentionForeground).width('100%')
        Text(this.call.approval.actionId).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
        Row({ space: 8 }) {
          Button($r('app.string.voice_call_deny')).layoutWeight(1).height(38).backgroundColor(this.colors.input).fontColor(this.colors.foreground)
            .onClick((): void => { this.call.respondApproval(false); })
          Button($r('app.string.voice_call_approve')).layoutWeight(1).height(38).backgroundColor(this.colors.accent)
            .onClick((): void => { this.call.respondApproval(true); })
        }.width('100%')
      }.width('100%').padding(14).backgroundColor(this.colors.attentionFill).borderRadius(this.colors.corner(18))
    }
  }

  @Builder miniControls() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 8 }) {
        Stack() {
          SymbolGlyph($r('sys.symbol.phone')).fontSize(16).fontColor([this.colors.accent])
        }.width(32).height(32).borderRadius(16).backgroundColor(this.colors.accentSoft).accessibilityLevel('no')
        Column({ space: 2 }) {
          Text(this.call.name || $r('app.string.voice_call_title')).fontSize(13).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          Row({ space: 6 }) {
            Text(this.status()).fontSize(11).fontColor(this.colors.secondary).maxLines(1).flexShrink(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(this.elapsed()).fontSize(11).fontColor(this.colors.secondary).maxLines(1).flexShrink(0)
          }.width('100%')
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }.width('100%')
    }.id('voice-call-mini-open').layoutWeight(1).height(44).padding({ left: 4, right: 4 }).backgroundColor(Color.Transparent)
      .borderRadius(22).clipShape(xopcRoundedClip(22))
      .accessibilityDescription($r('app.string.voice_call_return')).onClick((): void => { this.call.expanded = true; })
    Button({ type: ButtonType.Circle }) {
      SymbolGlyph($r('sys.symbol.phone')).fontSize(17).fontColor([Color.White]).rotate({ angle: 135 })
    }.id('voice-call-mini-end').width(32).height(32).padding(0).backgroundColor(this.colors.danger)
      .margin({ right: 6 }).responseRegion({ x: -6, y: -6, width: 44, height: 44 })
      .accessibilityText($r('app.string.voice_call_end')).onClick((): void => { this.call.end(); })
  }

  build() {
    if (this.call.phase !== 'idle') {
      if (this.call.expanded) {
        Column() {
          Row() {
            Button() { SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(22).fontColor([this.colors.foreground]) }
              .width(42).height(42).padding(0).backgroundColor(this.colors.input).borderRadius(21)
              .onClick((): void => { this.call.expanded = false; })
            Blank()
            Text(this.call.mode === 'assistant' ? $r('app.string.voice_call_assistant') : $r('app.string.voice_call_natural'))
              .fontSize(12).fontColor(this.colors.secondary).padding({ left: 11, right: 11, top: 6, bottom: 6 })
              .backgroundColor(this.colors.input).borderRadius(this.colors.corner(14))
          }.width('100%')
          Blank()
          Stack() {
            Circle().width(160).height(160).fill(this.colors.accentSoft)
            Circle().width(112).height(112).fill(this.colors.accent).opacity(0.13)
            SymbolGlyph($r('sys.symbol.waveform')).fontSize(62).fontColor([this.colors.accent])
          }.width(180).height(180)
          Text(this.call.name || $r('app.string.voice_call_title')).fontSize(25).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).margin({ top: 18 })
          Text(this.status()).fontSize(15).fontColor(this.call.phase === 'paused' && this.call.error ? this.colors.danger : this.colors.secondary).margin({ top: 8 })
          Text(this.elapsed()).fontSize(13).fontColor(this.colors.tertiary).margin({ top: 5 })
          if (this.call.error) { Text(this.errorMessage()).fontSize(12).fontColor(this.colors.danger).margin({ top: 8 }) }
          if (this.call.clarification || this.call.approval) {
            Column() { this.intervention() }.width('100%').padding({ left: 18, right: 18, top: 20 })
          } else if (this.call.assistantText || this.call.userText) {
            Text(this.call.assistantText || this.call.userText).fontSize(14).fontColor(this.colors.secondary).maxLines(4)
              .textAlign(TextAlign.Center).width('86%').margin({ top: 20 })
          }
          Blank()
          if (this.call.responseId || this.call.taskId) {
            Button(this.call.taskId ? $r('app.string.voice_call_cancel_task') : $r('app.string.voice_call_stop_reply'))
              .height(38).fontSize(13).backgroundColor(this.colors.input).fontColor(this.colors.foreground).margin({ bottom: 20 })
              .onClick((): void => { if (this.call.taskId) this.call.cancelTask(); else this.call.stopReply(); })
          }
          Row() {
            this.control({ label: $r('app.string.voice_call_mute'), controlId: 'voice-call-mute',
              symbol: this.call.muted ? $r('sys.symbol.mic_slash_fill') : $r('sys.symbol.mic'),
              active: this.call.muted, available: this.call.phase === 'connected', action: (): void => { this.call.setMuted(!this.call.muted); } })
            this.control({ label: $r('app.string.voice_call_speaker'), controlId: 'voice-call-speaker',
              symbol: $r('sys.symbol.speaker_wave_2'), active: this.call.speaker, available: this.call.phase === 'connected',
              action: (): void => { this.call.setSpeaker(!this.call.speaker); } })
            if (this.call.phase === 'paused') {
              this.control({ label: $r('app.string.voice_call_retry'), controlId: 'voice-call-retry',
                symbol: $r('sys.symbol.arrow_clockwise'), active: false, available: true, action: (): void => { this.call.resume(); } })
            }
            Column({ space: 7 }) {
              Button({ type: ButtonType.Circle }) { SymbolGlyph($r('sys.symbol.xmark')).fontSize(24).fontColor([Color.White]) }
                .width(54).height(54).padding(0).backgroundColor(this.colors.danger).onClick((): void => { this.call.end(); })
              Text($r('app.string.voice_call_end')).fontSize(12).fontColor(this.colors.secondary)
            }.width(78)
          }.width('100%').justifyContent(FlexAlign.Center).padding({ bottom: 26 })
        }.width('100%').height('100%').padding({ top: 16, left: 16, right: 16 }).backgroundColor(this.colors.surface).zIndex(60)
      } else {
        XopcFloatingAudioCard({ cardId: 'voice-call-mini', viewportWidth: this.viewportWidth,
          viewportHeight: this.viewportHeight, topClearance: 58, bottomClearance: 52, dragPosition: this.miniPosition,
          content: () => { this.miniControls(); } })
          .zIndex(60)
      }
    }
  }
}
