import { XopcVoiceCall } from '../service/voiceCall';

@ComponentV2
export struct XopcVoiceCallView {
  @Require @Param call: XopcVoiceCall;
  @Local now: number = Date.now();
  @Local answer: string = '';
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

  @Builder
  control(label: Resource, symbol: Resource, active: boolean, action: () => void) {
    Column({ space: 7 }) {
      Button({ type: ButtonType.Circle }) { SymbolGlyph(symbol).fontSize(24).fontColor([active ? $r('app.color.accent') : $r('app.color.foreground')]) }
        .width(54).height(54).padding(0).backgroundColor(active ? $r('app.color.accent_soft') : $r('app.color.input'))
        .onClick(action)
      Text(label).fontSize(12).fontColor($r('app.color.secondary'))
    }.width(78)
  }

  @Builder
  intervention() {
    if (this.call.clarification) {
      Column({ space: 10 }) {
        Text(this.call.clarification.question).fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground')).width('100%')
        if (this.call.clarification.choices.length) {
          Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Start }) {
            ForEach(this.call.clarification.choices, (choice: string): void => {
              Button(choice).height(34).fontSize(12).margin({ right: 7, bottom: 7 }).backgroundColor($r('app.color.accent_soft'))
                .fontColor($r('app.color.accent')).onClick((): void => { this.call.submitClarification('answer', choice); })
            })
          }.width('100%')
        }
        TextInput({ text: this.answer, placeholder: this.call.clarification.suggestedAnswer || $r('app.string.voice_call_answer') })
          .height(42).backgroundColor($r('app.color.input')).borderRadius(12).onChange((value: string): void => { this.answer = value; })
        Row({ space: 8 }) {
          Button($r('app.string.voice_call_agent_decide')).layoutWeight(1).height(38).fontSize(12).backgroundColor($r('app.color.input'))
            .fontColor($r('app.color.foreground')).onClick((): void => { this.call.submitClarification('agent_decide'); })
          Button($r('app.string.send')).layoutWeight(1).height(38).fontSize(12).backgroundColor($r('app.color.accent'))
            .onClick((): void => { if (this.answer.trim()) { this.call.submitClarification('answer', this.answer.trim()); this.answer = ''; } })
        }.width('100%')
      }.width('100%').padding(14).backgroundColor($r('app.color.panel')).borderRadius(18).border({ width: 1, color: $r('app.color.border_subtle') })
    } else if (this.call.approval) {
      Column({ space: 10 }) {
        Text($r('app.string.voice_call_approval')).fontSize(13).fontColor($r('app.color.secondary')).width('100%')
        Text(this.call.approval.actionId).fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground')).width('100%')
        Row({ space: 8 }) {
          Button($r('app.string.voice_call_deny')).layoutWeight(1).height(38).backgroundColor($r('app.color.input')).fontColor($r('app.color.foreground'))
            .onClick((): void => { this.call.respondApproval(false); })
          Button($r('app.string.voice_call_approve')).layoutWeight(1).height(38).backgroundColor($r('app.color.accent'))
            .onClick((): void => { this.call.respondApproval(true); })
        }.width('100%')
      }.width('100%').padding(14).backgroundColor($r('app.color.panel')).borderRadius(18).border({ width: 1, color: $r('app.color.border_subtle') })
    }
  }

  build() {
    if (this.call.phase !== 'idle') {
      if (this.call.expanded) {
        Column() {
          Row() {
            Button() { SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(22).fontColor([$r('app.color.foreground')]) }
              .width(42).height(42).padding(0).backgroundColor($r('app.color.input')).borderRadius(21)
              .onClick((): void => { this.call.expanded = false; })
            Blank()
            Text(this.call.mode === 'assistant' ? $r('app.string.voice_call_assistant') : $r('app.string.voice_call_natural'))
              .fontSize(12).fontColor($r('app.color.secondary')).padding({ left: 11, right: 11, top: 6, bottom: 6 })
              .backgroundColor($r('app.color.input')).borderRadius(14)
          }.width('100%')
          Blank()
          Stack() {
            Circle().width(160).height(160).fill($r('app.color.accent_soft'))
            Circle().width(112).height(112).fill($r('app.color.accent')).opacity(0.13)
            SymbolGlyph($r('sys.symbol.waveform')).fontSize(62).fontColor([$r('app.color.accent')])
          }.width(180).height(180)
          Text(this.call.name || $r('app.string.voice_call_title')).fontSize(25).fontWeight(FontWeight.Bold).fontColor($r('app.color.foreground')).margin({ top: 18 })
          Text(this.status()).fontSize(15).fontColor(this.call.error ? $r('app.color.danger') : $r('app.color.secondary')).margin({ top: 8 })
          Text(this.elapsed()).fontSize(13).fontColor($r('app.color.tertiary')).margin({ top: 5 })
          if (this.call.error) { Text(this.call.error).fontSize(12).fontColor($r('app.color.danger')).margin({ top: 8 }) }
          if (this.call.clarification || this.call.approval) {
            Column() { this.intervention() }.width('100%').padding({ left: 18, right: 18, top: 20 })
          } else if (this.call.assistantText || this.call.userText) {
            Text(this.call.assistantText || this.call.userText).fontSize(14).fontColor($r('app.color.secondary')).maxLines(4)
              .textAlign(TextAlign.Center).width('86%').margin({ top: 20 })
          }
          Blank()
          if (this.call.responseId || this.call.taskId) {
            Button(this.call.taskId ? $r('app.string.voice_call_cancel_task') : $r('app.string.voice_call_stop_reply'))
              .height(38).fontSize(13).backgroundColor($r('app.color.input')).fontColor($r('app.color.foreground')).margin({ bottom: 20 })
              .onClick((): void => { if (this.call.taskId) this.call.cancelTask(); else this.call.stopReply(); })
          }
          Row() {
            this.control($r('app.string.voice_call_mute'), $r('sys.symbol.mic'), this.call.muted, (): void => { this.call.setMuted(!this.call.muted); })
            this.control($r('app.string.voice_call_speaker'), $r('sys.symbol.speaker_wave_2'), this.call.speaker, (): void => { this.call.setSpeaker(!this.call.speaker); })
            if (this.call.phase === 'paused') {
              this.control($r('app.string.voice_call_retry'), $r('sys.symbol.arrow_clockwise'), false, (): void => { this.call.resume(); })
            }
            Column({ space: 7 }) {
              Button({ type: ButtonType.Circle }) { SymbolGlyph($r('sys.symbol.xmark')).fontSize(24).fontColor([Color.White]) }
                .width(54).height(54).padding(0).backgroundColor($r('app.color.danger')).onClick((): void => { this.call.end(); })
              Text($r('app.string.voice_call_end')).fontSize(12).fontColor($r('app.color.secondary'))
            }.width(78)
          }.width('100%').justifyContent(FlexAlign.Center).padding({ bottom: 26 })
        }.width('100%').height('100%').padding({ top: 16, left: 16, right: 16 }).backgroundColor($r('app.color.surface')).zIndex(60)
      } else {
        Row({ space: 10 }) {
          SymbolGlyph($r('sys.symbol.waveform')).fontSize(25).fontColor([$r('app.color.accent')])
          Column({ space: 2 }) {
            Text(this.call.name || $r('app.string.voice_call_title')).fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground')).maxLines(1)
            Text(this.status()).fontSize(11).fontColor($r('app.color.secondary')).maxLines(1)
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          Text(this.elapsed()).fontSize(11).fontColor($r('app.color.tertiary'))
          Button() { SymbolGlyph($r('sys.symbol.xmark')).fontSize(18).fontColor([Color.White]) }
            .width(38).height(38).padding(0).backgroundColor($r('app.color.danger')).borderRadius(19).onClick((): void => { this.call.end(); })
        }.id('voice-call-mini').width('92%').height(62).padding({ left: 14, right: 10 }).backgroundColor($r('app.color.panel'))
          .borderRadius(18).border({ width: 1, color: $r('app.color.border_subtle') }).position({ x: '4%', y: 66 }).zIndex(60)
          .onClick((): void => { this.call.expanded = true; })
      }
    }
  }
}
