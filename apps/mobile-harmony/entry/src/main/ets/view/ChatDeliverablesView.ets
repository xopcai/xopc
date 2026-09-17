import { common } from '@kit.AbilityKit';
import { systemShare } from '@kit.ShareKit';
import { uniformTypeDescriptor } from '@kit.ArkData';
import { XopcArtifact, XopcChatRow, XopcProductDelivery, XopcProductReference } from '../model/chat';
import { XopcMobileRoute } from '../model/home';
import { artifactMedia, chatDeliveries, chatProductCapability } from '../common/chatRichContent';
import { markdownLink } from '../common/markdown';
import { XopcChatMediaView } from './ChatMediaView';
import { appSettings } from '../service/settings';

@ComponentV2
export struct XopcChatDeliverablesView {
  @Param row: XopcChatRow = { id: '', role: 'assistant', text: '' };
  @Param conversationId: string = '';
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Event onFillDraft: (text: string) => void = (_text: string): void => {};
  @Computed get deliveries(): XopcProductDelivery[] { return chatDeliveries(this.row); }
  @Computed get artifacts(): XopcArtifact[] { return this.row.outcome?.deliverables || []; }
  private status(artifact: XopcArtifact): Resource {
    if (artifact.availability === 'materializing') return $r('app.string.chat_artifact_materializing');
    if (artifact.availability === 'expired') return $r('app.string.chat_artifact_expired');
    if (artifact.availability === 'missing') return $r('app.string.chat_artifact_missing');
    if (artifact.availability === 'failed') return $r('app.string.chat_artifact_failed');
    return $r('app.string.chat_artifact_unavailable');
  }
  private productPage(reference?: XopcProductReference): string {
    if (!chatProductCapability(reference, 'open')) return '';
    switch (reference?.kind) {
      case 'task': return 'tasks';
      case 'project': return 'projects';
      case 'note': return 'notes';
      case 'automation': return 'automations';
      case 'session': return 'chat';
      case 'settings': return 'settings';
      case 'file': return 'files';
      case 'workflow_run': return 'workflows';
      default: return '';
    }
  }
  private operationLabel(operation: string): Resource {
    switch (operation) {
      case 'created': return $r('app.string.chat_product_created');
      case 'updated': return $r('app.string.chat_product_updated');
      case 'started': return $r('app.string.chat_product_started');
      case 'completed': return $r('app.string.chat_tool_done');
      case 'failed': return $r('app.string.chat_tool_failed');
      default: return $r('app.string.chat_product_ready');
    }
  }
  private continueProduct(reference?: XopcProductReference): void {
    if (!reference || !this.conversationId || !chatProductCapability(reference, 'continue_in_chat')) return;
    this.onFillDraft(appSettings.effectiveLanguage().startsWith('zh') ? '继续处理「' + reference.title + '」（ID: ' + reference.id + '）：'
      : 'Continue working on "' + reference.title + '" (ID: ' + reference.id + '): ');
  }
  private async shareProduct(reference?: XopcProductReference): Promise<void> {
    if (!reference || !chatProductCapability(reference, 'share')) return;
    try {
      const content = reference.title + (reference.summary ? '\n\n' + reference.summary : '');
      if ((content.length + reference.title.length) * 3 > 190000) throw new Error('SHARE_TOO_LARGE');
      const data = new systemShare.SharedData({ utd: uniformTypeDescriptor.UniformDataType.PLAIN_TEXT, content, title: reference.title });
      await new systemShare.ShareController(data).show(this.getUIContext().getHostContext() as common.UIAbilityContext,
        { selectionMode: systemShare.SelectionMode.SINGLE, previewMode: systemShare.SharePreviewMode.DEFAULT });
    } catch (_) { this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_share_failed') }); }
  }
  private async openLink(href: string): Promise<void> {
    if (!markdownLink(href)) return;
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({ title: $r('app.string.chat_open_link'), message: href,
        buttons: [{ text: $r('app.string.cancel'), color: $r('app.color.secondary') }, { text: $r('app.string.open'), color: $r('app.color.accent') }] });
      if (result.index === 1) await (this.getUIContext().getHostContext() as common.UIAbilityContext).openLink(href, { appLinkingOnly: false });
    } catch (_) { this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_link_failed') }); }
  }
  build() {
    Column({ space: 10 }) {
      if (!this.row.live && (this.artifacts.length || this.deliveries.length)) {
        Text($r('app.string.chat_deliverables')).fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.secondary'))
        Repeat<XopcArtifact>(this.artifacts).each((item: RepeatItem<XopcArtifact>) => {
          if (item.item.availability === 'available' && (item.item.uri || item.item.workspaceRelativePath)) {
            XopcChatMediaView({ file: artifactMedia(item.item), conversationId: this.conversationId })
          } else if (item.item.availability === 'available' && markdownLink(item.item.shareUrl || '')) {
            Button(item.item.title).height(48).width('100%').fontSize(15).fontColor($r('app.color.accent'))
              .backgroundColor($r('app.color.grouped')).onClick((): void => { this.openLink(item.item.shareUrl || ''); })
          } else {
            Column({ space: 4 }) {
              Text(item.item.title).fontSize(15).fontColor($r('app.color.foreground'))
              Text(this.status(item.item)).fontSize(12).fontColor($r('app.color.secondary'))
            }.id('chat-artifact-' + item.item.artifactId).width('100%').padding(12).borderRadius(10)
              .alignItems(HorizontalAlign.Start).backgroundColor($r('app.color.grouped'))
          }
        }).key((artifact: XopcArtifact): string => artifact.artifactId)
        Repeat<XopcProductDelivery>(this.deliveries).each((item: RepeatItem<XopcProductDelivery>) => {
          Column({ space: 0 }) {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 10 }) {
              SymbolGlyph($r('sys.symbol.doc_plaintext')).fontSize(20).fontColor([$r('app.color.accent')])
              Column({ space: 4 }) {
                Text(item.item.primary?.title || '').fontSize(15).fontColor($r('app.color.foreground'))
                Text(this.operationLabel(item.item.operation)).fontSize(12).fontColor($r('app.color.secondary'))
                if (item.item.primary?.status) { Text(item.item.primary?.status || '').fontSize(12).fontColor($r('app.color.secondary')) }
                if (item.item.primary?.summary) { Text(item.item.primary?.summary || '').fontSize(12).maxLines(2).fontColor($r('app.color.secondary')) }
                if (!this.productPage(item.item.primary) && chatProductCapability(item.item.primary, 'open')) { Text($r('app.string.chat_artifact_unavailable')).fontSize(12).fontColor($r('app.color.secondary')) }
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              if (this.productPage(item.item.primary)) { SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([$r('app.color.secondary')]) }
            }.width('100%')
          }.constraintSize({ minHeight: 56 }).padding(12).width('100%').borderRadius(10).backgroundColor($r('app.color.grouped'))
            .onClick((): void => {
              const reference = item.item.primary; const page = this.productPage(reference);
              if (reference && page) this.onNavigate({ page, itemId: reference.id });
            })
          Row({ space: 8 }) {
            if (chatProductCapability(item.item.primary, 'share')) {
              Button($r('app.string.chat_share')).id('chat-product-share-' + item.item.primary?.id).height(44).fontSize(13)
                .backgroundColor(Color.Transparent).fontColor($r('app.color.accent')).onClick((): void => { this.shareProduct(item.item.primary); })
            }
            if (this.conversationId && chatProductCapability(item.item.primary, 'continue_in_chat')) {
              Button($r('app.string.chat_continue')).id('chat-product-continue-' + item.item.primary?.id).height(44).fontSize(13)
                .backgroundColor(Color.Transparent).fontColor($r('app.color.accent')).onClick((): void => { this.continueProduct(item.item.primary); })
            }
          }.width('100%')
          }.width('100%').borderRadius(10).backgroundColor($r('app.color.grouped'))
        }).key((delivery: XopcProductDelivery): string => delivery.operation + ':' + delivery.primary?.kind + ':' + delivery.primary?.id)
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
