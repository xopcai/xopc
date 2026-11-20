import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { userErrorMessage } from '../common/userError';

@ComponentV2
export struct XopcSessionRenameForm {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param name: string = '';
  @Param busy: boolean = false;
  @Param error: string = '';
  @Event onChange: (name: string) => void = (_name: string): void => {};
  @Event onCancel: () => void = (): void => {};
  @Event onSave: () => void = (): void => {};

  build() {
    Column({ space: 16 }) {
      Text($r('app.string.sessions_rename')).fontSize(20).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
      TextInput({ text: this.name, placeholder: $r('app.string.name') }).id('sessions-rename-input')
        .onChange((name: string): void => { this.onChange(name); }).enabled(!this.busy)
      if (this.error) { Text(userErrorMessage(this.error, 'save')).fontColor(this.colors.danger).fontSize(13) }
      Row({ space: 12 }) {
        Button($r('app.string.cancel')).layoutWeight(1).height(44).enabled(!this.busy)
          .onClick((): void => { this.onCancel(); })
        Button($r('app.string.save')).id('sessions-rename-save').layoutWeight(1).height(44)
          .enabled(!this.busy && this.name.trim().length > 0)
          .onClick((): void => { this.onSave(); })
      }
    }.width('100%').padding(20)
  }
}
