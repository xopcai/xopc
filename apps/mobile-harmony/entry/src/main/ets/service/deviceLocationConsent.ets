import { ComponentContent, UIContext } from '@kit.ArkUI';

interface XopcLocationConsentView {
  message: string;
  decide: (allowed: boolean) => void;
}
export interface XopcLocationConsentHandle {
  answer: Promise<boolean>;
  cancel: () => void;
}

@Builder
function xopcLocationConsentView(params: XopcLocationConsentView) {
  Column({ space: 20 }) {
    Text('允许本次使用位置？').fontSize(20).fontWeight(FontWeight.Medium)
    Text(params.message).fontSize(16)
    Row({ space: 16 }) {
      Button('拒绝').onClick(() => { params.decide(false); })
      Button('允许一次').onClick(() => { params.decide(true); })
    }
  }.padding(24).width('90%').backgroundColor($r('sys.color.ohos_id_color_dialog_bg')).borderRadius(24)
}

export function openDeviceLocationConsent(ui: UIContext, message: string): XopcLocationConsentHandle {
  let settled: boolean = false;
  let opened: boolean = false;
  let resolveAnswer: (allowed: boolean) => void = (_allowed: boolean): void => {};
  const answer: Promise<boolean> = new Promise<boolean>((resolve) => { resolveAnswer = resolve; });
  let content: ComponentContent<XopcLocationConsentView>;
  const close = (): void => {
    if (opened) {
      opened = false;
      ui.getPromptAction().closeCustomDialog(content).then(() => { content.dispose(); }).catch(() => {});
    }
  };
  const decide = (allowed: boolean): void => {
    if (settled) return;
    settled = true; close(); resolveAnswer(allowed);
  };
  const params: XopcLocationConsentView = { message, decide };
  content = new ComponentContent<XopcLocationConsentView>(ui, wrapBuilder(xopcLocationConsentView), params);
  ui.getPromptAction().openCustomDialog(content, { autoCancel: false, onWillDismiss: (action) => { action.dismiss(); decide(false); } })
    .then(() => { opened = true; if (settled) close(); }).catch(() => { decide(false); content.dispose(); });
  return { answer, cancel: (): void => { decide(false); } };
}
