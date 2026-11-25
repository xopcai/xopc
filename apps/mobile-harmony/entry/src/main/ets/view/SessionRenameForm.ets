import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { userErrorMessage } from '../common/userError';
import { XopcButton, XopcSheetHeader } from './MobileComponents';

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
    Column() {
      XopcSheetHeader({
        heading: $r('app.string.sessions_rename'),
        closeId: 'sessions-rename-close',
        onClose: (): void => { if (!this.busy) this.onCancel(); },
      })
      Column({ space: 16 }) {
        TextInput({ text: this.name, placeholder: $r('app.string.name') }).id('sessions-rename-input')
          .height(46).backgroundColor(this.colors.input).fontColor(this.colors.foreground)
          .placeholderColor(this.colors.tertiary).borderRadius(this.colors.corner(12))
          .onChange((name: string): void => { this.onChange(name); }).enabled(!this.busy)
        if (this.error) { Text(userErrorMessage(this.error, 'save')).fontColor(this.colors.danger).fontSize(13) }
        Row({ space: 12 }) {
          XopcButton({
            label: $r('app.string.cancel'),
            variant: 'secondary',
            fullWidth: true,
            buttonEnabled: !this.busy,
            onAction: (): void => { this.onCancel(); },
          }).layoutWeight(1)
          XopcButton({
            label: $r('app.string.save'),
            variant: 'primary',
            buttonId: 'sessions-rename-save',
            fullWidth: true,
            loading: this.busy,
            buttonEnabled: !this.busy && this.name.trim().length > 0,
            onAction: (): void => { this.onSave(); },
          }).layoutWeight(1)
        }.width('100%')
      }.width('100%').padding({ left: 20, right: 20, top: 4, bottom: 20 })
    }.width('100%')
  }
}
