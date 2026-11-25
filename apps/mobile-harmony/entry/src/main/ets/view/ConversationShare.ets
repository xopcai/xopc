import { common } from '@kit.AbilityKit';
import { xopcConfirmDialog } from '../common/dialogActions';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcSessionShareAttachment, XopcSessionShareMessage, XopcSessionSharePreview, XopcShareResult } from '../model/share';
import { shareService } from '../service/shareService';
import { gatewaySession } from '../service/gatewaySession';
import { copyChatMessage } from '../service/chatMessageActions';
import { shareChatLink, shareReachabilityText } from '../service/chatMediaShare';
import { appSettings } from '../service/settings';
import { XopcSheetHeader } from './MobileComponents';

interface XopcShareTerm { ttl: number; label: Resource; }

@ComponentV2
export struct XopcConversationShare {
  @Require @Param conversationId: string;
  @Event onClose: () => void = (): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local snapshot?: XopcSessionSharePreview;
  @Local result?: XopcShareResult;
  @Local selectedIds: string[] = [];
  @Local termIndex: number = 1;
  @Local busy: boolean = true;
  @Local failed: boolean = false;
  @Local previewOpen: boolean = false;
  @Local filesOpen: boolean = false;
  @Local revoked: boolean = false;
  @Local copied: boolean = false;
  private active: boolean = false;
  private account: string = '';
  private terms: XopcShareTerm[] = [
    { ttl: 3600000, label: $r('app.string.session_share_hour') },
    { ttl: 86400000, label: $r('app.string.session_share_day') },
    { ttl: 604800000, label: $r('app.string.session_share_week') },
    { ttl: 2592000000, label: $r('app.string.session_share_month') }
  ];

  aboutToAppear(): void {
    this.active = true;
    this.account = this.currentAccount();
    void this.load();
  }

  aboutToDisappear(): void { this.active = false; }

  private currentAccount(): string {
    const profile = gatewaySession.currentProfile();
    return profile ? profile.gatewayId + ':' + profile.deviceId : '';
  }

  private isCurrent(id: string): boolean {
    return this.active && this.conversationId === id && this.account === this.currentAccount();
  }

  private selectedFiles(): XopcSessionShareAttachment[] {
    return this.snapshot?.attachmentCandidates.filter((file: XopcSessionShareAttachment): boolean => this.selectedIds.includes(file.id)) ?? [];
  }

  private async load(): Promise<void> {
    const id = this.conversationId;
    if (!this.isCurrent(id)) return;
    this.busy = true;
    this.failed = false;
    try {
      const active = await shareService.activeSessionShare(id);
      if (!this.isCurrent(id)) return;
      const snapshot = active ? undefined : await shareService.sessionPreview(id);
      if (!this.isCurrent(id)) return;
      this.snapshot = snapshot;
      this.result = active;
      this.revoked = false;
    } catch (_) {
      if (this.isCurrent(id)) this.failed = true;
    } finally {
      if (this.isCurrent(id)) this.busy = false;
    }
  }

  private async createLink(): Promise<void> {
    const snapshot = this.snapshot;
    const id = this.conversationId;
    if (this.busy || !snapshot || !this.isCurrent(id)) return;
    this.busy = true;
    this.failed = false;
    try {
      const files = this.selectedFiles().map((file: XopcSessionShareAttachment): string => file.id);
      const result = await shareService.session(id, snapshot, this.terms[this.termIndex].ttl, files);
      if (this.isCurrent(id)) this.result = result;
    } catch (_) {
      if (this.isCurrent(id)) this.failed = true;
    } finally {
      if (this.isCurrent(id)) this.busy = false;
    }
  }

  private async revokeLink(): Promise<void> {
    const result = this.result;
    const id = this.conversationId;
    if (this.busy || !result || !this.isCurrent(id)) return;
    const confirmed = await xopcConfirmDialog(this.getUIContext(), {
      title: $r('app.string.share_revoke'),
      message: $r('app.string.share_revoke_confirm'),
      confirmLabel: $r('app.string.share_revoke'),
      destructive: true,
    });
    if (!confirmed || !this.isCurrent(id) || this.busy) return;
    this.busy = true;
    this.failed = false;
    try {
      await shareService.revoke(result.id);
      if (this.isCurrent(id)) {
        this.result = undefined;
        this.snapshot = undefined;
        this.revoked = true;
      }
    } catch (_) {
      if (this.isCurrent(id)) this.failed = true;
    } finally {
      if (this.isCurrent(id)) this.busy = false;
    }
  }

  private async useLink(action: string, share: XopcShareResult): Promise<void> {
    if (!this.isCurrent(this.conversationId)) return;
    try {
      if (action === 'copy') {
        await copyChatMessage(share.shareUrl);
        this.copied = true;
        return;
      }
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      if (action === 'open') await context.openLink(share.shareUrl, { appLinkingOnly: false });
      else await shareChatLink(context, share);
    } catch (_) { this.failed = true; }
  }

  @Builder
  snapshotCard(title: string, messages: number, files: number, previewAction: boolean) {
    Row({ space: 8 }) {
      Column({ space: 4 }) {
        Text(title).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
        Text($r('app.string.session_share_count', messages, files)).fontSize(13).fontColor(this.colors.secondary).width('100%')
      }.layoutWeight(1)
      if (previewAction) {
        Button($r('app.string.share_preview')).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.accent)
          .enabled(!this.busy).onClick((): void => { this.previewOpen = true; })
      }
    }.width('100%').padding(12).borderRadius(this.colors.corner(14)).backgroundColor(this.colors.input)
  }

  @Builder
  setup(snapshot: XopcSessionSharePreview) {
    this.snapshotCard(snapshot.title, snapshot.messageCount, this.selectedFiles().length, true)
    if (snapshot.attachmentCandidates.length) {
      Button($r('app.string.session_share_attachments', this.selectedFiles().length))
        .height(44).width('100%').backgroundColor(this.colors.input).fontColor(this.colors.foreground)
        .enabled(!this.busy).onClick((): void => { this.filesOpen = !this.filesOpen; })
      if (this.filesOpen) {
        ForEach(snapshot.attachmentCandidates, (file: XopcSessionShareAttachment) => {
          Button((this.selectedIds.includes(file.id) ? '✓  ' : '○  ') + file.fileName)
            .width('100%').constraintSize({ minHeight: 44 }).backgroundColor(this.colors.input)
            .fontColor(this.colors.foreground).enabled(!this.busy)
            .accessibilitySelected(this.selectedIds.includes(file.id))
            .onClick((): void => {
              this.selectedIds = this.selectedIds.includes(file.id)
                ? this.selectedIds.filter((id: string): boolean => id !== file.id) : this.selectedIds.concat(file.id);
            })
        }, (file: XopcSessionShareAttachment): string => file.id)
      }
    }
    Row({ space: 8 }) {
      Text($r('app.string.session_share_expiry')).layoutWeight(1).fontColor(this.colors.foreground)
      Select([{ value: this.terms[0].label }, { value: this.terms[1].label },
        { value: this.terms[2].label }, { value: this.terms[3].label }])
        .selected(this.termIndex).value(this.terms[this.termIndex].label).enabled(!this.busy)
        .onSelect((index: number): void => { this.termIndex = index; })
    }.width('100%').padding({ left: 12, right: 8, top: 6, bottom: 6 })
      .borderRadius(this.colors.corner(12)).backgroundColor(this.colors.input)
    Text($r('app.string.session_share_disclosure')).fontSize(13).fontColor(this.colors.secondary).width('100%')
    Button($r('app.string.session_share_create')).id('conversation-share-create').width('100%').height(48)
      .backgroundColor(this.colors.accent).fontColor(this.colors.onAccent)
      .enabled(!this.busy && !this.failed && snapshot.messageCount > 0).onClick((): void => { void this.createLink(); })
  }

  @Builder
  preview(snapshot: XopcSessionSharePreview) {
    this.snapshotCard(snapshot.title, snapshot.messageCount, this.selectedFiles().length, false)
    ForEach(snapshot.messages, (message: XopcSessionShareMessage) => {
      Row() {
        Text(message.markdown).fontSize(15).fontColor(this.colors.foreground).padding(12)
          .constraintSize({ maxWidth: '94%' }).borderRadius(this.colors.corner(14))
          .backgroundColor(message.role === 'user' ? this.colors.input : this.colors.grouped)
      }.width('100%').justifyContent(message.role === 'user' ? FlexAlign.End : FlexAlign.Start)
    }, (message: XopcSessionShareMessage): string => message.id)
    ForEach(this.selectedFiles(), (file: XopcSessionShareAttachment) => {
      Text(file.fileName).fontSize(14).fontColor(this.colors.secondary).width('100%')
    }, (file: XopcSessionShareAttachment): string => file.id)
  }

  @Builder
  link(share: XopcShareResult) {
    this.snapshotCard(share.title, share.messageCount ?? 0, share.attachmentCount ?? 0, false)
    Text(share.shareUrl).copyOption(CopyOptions.InApp).fontSize(14).fontColor(this.colors.accent).width('100%')
    Text(new Date(share.expiresAt).toLocaleString()).fontSize(13).fontColor(this.colors.secondary).width('100%')
    if (share.reachability !== 'public') {
      Text(shareReachabilityText(share, appSettings.effectiveLanguage().startsWith('zh')))
        .fontSize(13).fontColor(this.colors.secondary).width('100%')
    }
    Button(this.copied ? $r('app.string.share_copied') : $r('app.string.chat_copy_link'))
      .width('100%').height(48).backgroundColor(this.colors.accent).fontColor(this.colors.onAccent)
      .enabled(!this.busy).onClick((): void => { void this.useLink('copy', share); })
    Row({ space: 8 }) {
      Button($r('app.string.session_share_open')).height(44).layoutWeight(1).backgroundColor(this.colors.input)
        .fontColor(this.colors.accent).enabled(!this.busy).onClick((): void => { void this.useLink('open', share); })
      Button($r('app.string.chat_system_share')).height(44).layoutWeight(1).backgroundColor(this.colors.input)
        .fontColor(this.colors.accent).enabled(!this.busy).onClick((): void => { void this.useLink('system', share); })
    }.width('100%')
    Button($r('app.string.share_revoke')).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.danger)
      .enabled(!this.busy).onClick((): void => { void this.revokeLink(); })
  }

  build() {
    Column() {
      XopcSheetHeader({
        heading: this.previewOpen ? $r('app.string.share_preview') : this.result ? $r('app.string.session_share_link')
          : this.revoked ? $r('app.string.session_share_revoked') : $r('app.string.share_session_title'),
        closeEnabled: !this.busy,
        onClose: (): void => { if (this.previewOpen) this.previewOpen = false; else this.onClose(); },
      })
      Scroll() {
        Column({ space: 12 }) {
          if (this.busy) { LoadingProgress().width(28).height(28).color(this.colors.accent) }
          if (this.failed) {
            Text($r('app.string.session_share_error')).fontColor(this.colors.danger).width('100%')
            if (!this.result) Button($r('app.string.retry')).height(44).onClick((): void => { void this.load(); })
          }
          if (this.result) { this.link(this.result) }
          else if (this.revoked) {
            Button($r('app.string.session_share_new')).width('100%').height(48).backgroundColor(this.colors.accent)
              .fontColor(this.colors.onAccent).enabled(!this.busy).onClick((): void => {
                this.selectedIds = []; this.termIndex = 1; this.copied = false; void this.load();
              })
          } else if (this.snapshot) {
            if (this.previewOpen) { this.preview(this.snapshot) }
            else { this.setup(this.snapshot) }
          }
        }.width('100%').padding({ left: 20, right: 20, bottom: 20 }).alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%').align(Alignment.Top).scrollBar(BarState.Off)
    }.width('100%').height('100%').backgroundColor(this.colors.panel)
  }
}
