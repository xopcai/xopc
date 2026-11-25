import { UIContext } from '@kit.ArkUI';
import { appThemeColors } from './themePalette';

export type XopcSheetPreset = 'compact' | 'medium' | 'large' | 'immersive';

export interface XopcSheetOverrides {
  height?: SheetSize | Length;
  dragBar?: boolean;
  showClose?: boolean;
  backgroundColor?: ResourceColor;
  onDisappear?: () => void;
  onWillDismiss?: Callback<DismissSheetAction>;
  shouldDismiss?: (action: SheetDismiss) => void;
}

export interface XopcConfirmDialogOptions {
  title?: ResourceStr;
  message: ResourceStr;
  cancelLabel?: ResourceStr;
  confirmLabel?: ResourceStr;
  destructive?: boolean;
}

export function xopcSheetOptions(preset: XopcSheetPreset, overrides?: XopcSheetOverrides): SheetOptions {
  let height: SheetSize | Length = SheetSize.LARGE;
  let dragBar: boolean = true;
  let backgroundColor: ResourceColor = appThemeColors.panel;
  if (preset === 'compact') {
    height = '45%';
    dragBar = true;
    backgroundColor = appThemeColors.panel;
  } else if (preset === 'medium') {
    height = '70%';
    dragBar = true;
    backgroundColor = appThemeColors.panel;
  } else if (preset === 'large') {
    height = SheetSize.LARGE;
    dragBar = true;
    backgroundColor = appThemeColors.panel;
  } else {
    height = '94%';
    dragBar = false;
    backgroundColor = appThemeColors.chat.canvas;
  }
  const options: SheetOptions = {
    height: overrides?.height ?? height,
    dragBar: overrides?.dragBar !== undefined ? overrides.dragBar : dragBar,
    showClose: overrides?.showClose !== undefined ? overrides.showClose : false,
    backgroundColor: overrides?.backgroundColor ?? backgroundColor,
  };
  if (overrides?.onDisappear) options.onDisappear = overrides.onDisappear;
  if (overrides?.onWillDismiss) options.onWillDismiss = overrides.onWillDismiss;
  if (overrides?.shouldDismiss) options.shouldDismiss = overrides.shouldDismiss;
  return options;
}

export async function xopcConfirmDialog(uiContext: UIContext, options: XopcConfirmDialogOptions): Promise<boolean> {
  try {
    const cancelText: ResourceStr = options.cancelLabel ?? $r('app.string.cancel');
    const confirmText: ResourceStr = options.confirmLabel ?? $r('app.string.confirm');
    const confirmColor: ResourceColor = options.destructive ? appThemeColors.danger : appThemeColors.accent;
    const result = await uiContext.getPromptAction().showDialog({
      title: options.title,
      message: options.message,
      buttons: [
        { text: cancelText, color: appThemeColors.secondary },
        { text: confirmText, color: confirmColor },
      ],
    });
    return result.index === 1;
  } catch (_) {
    return false;
  }
}

export function xopcToast(uiContext: UIContext, message: ResourceStr): void {
  try {
    uiContext.getPromptAction().showToast({ message });
  } catch (_) {}
}
