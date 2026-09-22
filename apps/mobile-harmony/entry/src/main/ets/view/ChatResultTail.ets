import { common } from '@kit.AbilityKit';
import { XopcArtifact, XopcChatRow, XopcProductDelivery, XopcProductReference } from '../model/chat';
import { XopcMobileRoute } from '../model/home';
import { artifactMedia, chatDeliveries, chatProductCapability } from '../common/chatRichContent';
import { markdownLink } from '../common/markdown';
import { XopcChatMediaView } from './ChatMediaView';
import { appSettings } from '../service/settings';

@ComponentV2
export struct XopcChatResultTail {
  @Param row: XopcChatRow = { id: '', role: 'assistant', text: '' };
  @Param conversationId: string = '';
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Event onFillDraft: (text: string) => void = (_text: string): void => {};
  @Computed get deliveries(): XopcProductDelivery[] { return chatDeliveries(this.row); }
  @Computed get visibleDeliveries(): XopcProductDelivery[] { return this.deliveries.slice(0, 3); }
  @Computed get hiddenDeliveryCount(): number { return Math.max(0, this.deliveries.length - this.visibleDeliveries.length); }
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
  private productState(delivery: XopcProductDelivery): Resource {
    if (delivery.primary?.status === 'inbox') return $r('app.string.chat_product_inbox');
    return this.operationLabel(delivery.operation);
  }
  private canOpenProduct(reference?: XopcProductReference): boolean {
    return !!this.productPage(reference)
      || (!!this.conversationId && chatProductCapability(reference, 'continue_in_chat'));
  }
  private openProduct(reference?: XopcProductReference): void {
    if (!reference) return;
    const page = this.productPage(reference);
    if (page) {
      this.onNavigate({ page, itemId: reference.id });
      return;
    }
    if (!this.conversationId || !chatProductCapability(reference, 'continue_in_chat')) return;
    this.onFillDraft(appSettings.effectiveLanguage().startsWith('zh')
      ? '继续处理「' + reference.title + '」（ID: ' + reference.id + '）：'
      : 'Continue working on "' + reference.title + '" (ID: ' + reference.id + '): ');
  }
  private async openLink(href: string): Promise<void> {
    if (!markdownLink(href)) return;
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({ title: $r('app.string.chat_open_link'), message: href,
        buttons: [{ text: $r('app.string.cancel'), color: $r('app.color.secondary') }, { text: $r('app.string.open'), color: $r('app.color.accent') }] });
      if (result.index === 1) await (this.getUIContext().getHostContext() as common.UIAbilityContext).openLink(href, { appLinkingOnly: false });
    } catch (_) {
      try { this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_link_failed') }); } catch (_) {}
    }
  }
  build() {
    if (!this.row.live && (this.artifacts.length || this.deliveries.length)) {
      Column({ space: 4 }) {
          Repeat<XopcArtifact>(this.artifacts).each((item: RepeatItem<XopcArtifact>) => {
            if (item.item.availability === 'available' && (item.item.uri || item.item.workspaceRelativePath)) {
              XopcChatMediaView({ file: artifactMedia(item.item), conversationId: this.conversationId, compact: true, embedded: true })
            } else if (item.item.availability === 'available' && markdownLink(item.item.shareUrl || '')) {
              Button({ type: ButtonType.Normal }) {
                Row({ space: 10 }) {
                  SymbolGlyph($r('sys.symbol.doc')).fontSize(20).fontColor([$r('app.color.secondary')])
                  Text(item.item.title).fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground'))
                    .layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([$r('app.color.tertiary')])
                }.width('100%')
              }.id('chat-artifact-' + item.item.artifactId).constraintSize({ minHeight: 56 }).padding({ left: 12, right: 12 })
                .width('100%').borderRadius(10).backgroundColor(Color.Transparent)
                .accessibilityText(item.item.title).onClick((): void => { this.openLink(item.item.shareUrl || ''); })
            } else {
              Row({ space: 10 }) {
                SymbolGlyph($r('sys.symbol.doc')).fontSize(20).fontColor([$r('app.color.secondary')])
                Column({ space: 2 }) {
                  Text(item.item.title).fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground'))
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text(this.status(item.item)).fontSize(12).fontColor($r('app.color.secondary')).maxLines(1)
                }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              }.id('chat-artifact-' + item.item.artifactId).width('100%').constraintSize({ minHeight: 56 })
                .padding({ left: 12, right: 12 }).borderRadius(10)
            }
          }).key((artifact: XopcArtifact): string => artifact.artifactId)
          Repeat<XopcProductDelivery>(this.visibleDeliveries).each((item: RepeatItem<XopcProductDelivery>) => {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 10 }) {
                SymbolGlyph($r('sys.symbol.doc_plaintext')).fontSize(20).fontColor([$r('app.color.accent')])
                Column({ space: 2 }) {
                  Text(item.item.primary?.title || '').fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground'))
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text(this.productState(item.item)).fontSize(12).fontColor($r('app.color.secondary')).maxLines(1)
                }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                if (this.canOpenProduct(item.item.primary)) {
                  SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([$r('app.color.tertiary')])
                }
              }.width('100%')
            }.id('chat-product-' + item.item.primary?.id).constraintSize({ minHeight: 56 }).padding({ left: 12, right: 12 })
              .width('100%').borderRadius(10).backgroundColor(Color.Transparent).enabled(this.canOpenProduct(item.item.primary))
              .accessibilityText((item.item.primary?.title || '')).onClick((): void => { this.openProduct(item.item.primary); })
          }).key((delivery: XopcProductDelivery): string => delivery.operation + ':' + delivery.primary?.kind + ':' + delivery.primary?.id)
          if (this.hiddenDeliveryCount > 0) {
            Text($r('app.string.chat_more_results', this.hiddenDeliveryCount)).height(44).fontSize(13)
              .fontWeight(FontWeight.Medium).fontColor($r('app.color.accent')).padding({ left: 12, right: 12 })
          }
      }.id('chat-result-tail-' + this.row.id).width('88%').constraintSize({ maxWidth: 420 }).padding(4)
        .borderRadius(14).backgroundColor($r('app.color.input'))
        .margin({ top: 8, bottom: 4 }).accessibilityText($r('app.string.chat_deliverables'))
    }
  }
}
