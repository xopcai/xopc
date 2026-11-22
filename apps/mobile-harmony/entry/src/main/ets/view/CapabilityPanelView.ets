import { common } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { fileIo as fs, fileUri } from '@kit.CoreFileKit';
import { image } from '@kit.ImageKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { markdownLink } from '../common/markdown';
import { gatewaySession } from '../service/gatewaySession';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { appSettings } from '../service/settings';
import { XopcHttpError } from '../service/transport';
import { XopcCapabilityLogo } from './CapabilityLogo';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';
import { XopcListSkeleton } from './MobileComponents';

interface CapabilityChoice { id: string; label: string; }
interface CapabilityFieldVisibility { field: string; value: string; }
interface CapabilityPanelLink { label: string; url: string; visibleWhen?: CapabilityFieldVisibility; }
interface CapabilityPanelCopyable { label: string; content: string; note?: string; visibleWhen?: CapabilityFieldVisibility; }
interface CapabilityField {
  id: string; label: string; type: string; value?: string; hint?: string; description?: string; required?: boolean;
  format?: string; addLabel?: string; keyLabel?: string; valueLabel?: string; keyPlaceholder?: string; maxItems?: number;
  options?: CapabilityChoice[]; advanced?: boolean; visibleWhen?: CapabilityFieldVisibility; presentation?: string; retain?: boolean;
}
interface CapabilityAction {
  id: string; label: string; confirmation?: string; inlineReview?: boolean; advanced?: boolean;
  visibleWhen?: CapabilityFieldVisibility; dismiss?: boolean;
}
interface CapabilitySearchResult { id: string; name: string; summary?: string; source: string; iconUrl?: string; action?: CapabilityAction; }
interface CapabilityPanelPayload {
  fields?: CapabilityField[]; actions?: CapabilityAction[]; message?: string; details?: string;
  headline?: string; subtitle?: string; steps?: string[]; links?: CapabilityPanelLink[]; copyable?: CapabilityPanelCopyable;
  reviewText?: string; tone?: string; advancedLabel?: string; detailsLabel?: string;
  authorizationUrl?: string; qrUrl?: string; flow?: string; revision?: number;
  deviceVerificationCode?: string; expiresAt?: number;
  pollAction?: string; results?: CapabilitySearchResult[]; chatPrompt?: string;
}
interface CapabilityPanelEnvelope { ok: boolean; payload?: CapabilityPanelPayload; error?: string; }
interface CapabilityPanelCommand { action: string; values: Record<string, string>; flow?: string; revision?: number; }

export function capabilityDrawerHeight(expanded: boolean): number | string {
  return expanded ? '82%' : 420;
}

@ComponentV2
export struct XopcCapabilityPanelView {
  @Param category: string = '';
  @Param itemId: string = '';
  @Param itemName: string = '';
  @Param description: string = '';
  @Param iconUrl: string = '';
  @Param avatarReference: string = '';
  @Param appearance: string = 'configured';
  @Param avatarRevision: number = 0;
  @Param initialId: string = '';
  @Param initialUrl: string = '';
  @Event onClose: () => void = (): void => {};
  @Event onChanged: () => void = (): void => {};
  @Event onExpandedChange: (expanded: boolean) => void = (_expanded: boolean): void => {};
  @Event onUseInChat: (prompt: string) => void = (_prompt: string): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Local panel?: CapabilityPanelPayload;
  @Local values: Map<string, string> = new Map<string, string>();
  @Local busy: boolean = false;
  @Local errorMessage: string = '';
  @Local advanced: boolean = false;
  @Local detailsOpen: boolean = false;
  @Local newGroup: string = '';
  @Local openedUrl: string = '';
  @Local showQr: boolean = false;
  @Local savingQr: boolean = false;
  @Local qrFeedback: string = '';
  @Local copiedBlock: boolean = false;
  private appliedInitial: boolean = false;
  private generation: number = 0;
  private alive: boolean = false;
  private pollTimer: number = -1;
  private deadline: number = 0;
  private openWhenReady: boolean = false;
  private pollingNow: boolean = false;
  private reportedExpanded: boolean = false;
  private retainedValues: Map<string, string> = new Map<string, string>();

  aboutToAppear(): void { this.alive = true; void this.request(); }
  aboutToDisappear(): void {
    this.alive = false;
    ++this.generation;
    this.clearPoll();
    this.values.clear();
    this.retainedValues.clear();
  }

  @Monitor('layout.foreground')
  onForegroundChange(): void {
    if (!this.layout.foreground) {
      this.clearPoll();
      return;
    }
    const action = this.panel?.pollAction;
    if (action) void this.request(action, true);
  }

  @Monitor('panel', 'values', 'showQr', 'advanced', 'detailsOpen')
  onDrawerContentChange(): void {
    if (!this.alive) return;
    const extraFields = this.fields(true);
    const shownFields = this.advanced ? this.fields(false).concat(extraFields) : this.fields(false);
    const expanded = (Boolean(this.panel?.qrUrl) && (!this.panel?.authorizationUrl || this.showQr)) ||
      Boolean(this.panel?.reviewText) ||
      this.panelStepsList().length > 0 || Boolean(this.visibleCopyable()) || this.visibleLinks().length > 0 ||
      (this.advanced && (extraFields.length > 0 || this.actions(true).length > 0)) ||
      (this.detailsOpen && Boolean(this.panel?.details)) || shownFields.length >= 3 ||
      shownFields.some((field: CapabilityField): boolean => ['multiline', 'list', 'headers'].includes(field.type)) ||
      (this.panel?.results?.length ?? 0) >= 3;
    if (expanded === this.reportedExpanded) return;
    this.reportedExpanded = expanded;
    this.onExpandedChange(expanded);
  }

  private t(zh: string, en: string): string { return appSettings.effectiveLanguage().startsWith('zh') ? zh : en; }

  private set(id: string, value: string): void {
    const updated = new Map<string, string>(this.values);
    updated.set(id, value);
    this.values = updated;
  }

  private setField(field: CapabilityField, text: string): void {
    this.set(field.id, text);
    if (field.retain) this.retainedValues.set(field.id, text);
    if (field.presentation === 'segmented') {
      this.getUIContext().getFocusController().clearFocus();
      this.errorMessage = '';
    }
  }

  private isVisible(rule?: CapabilityFieldVisibility): boolean {
    return !rule || (this.values.get(rule.field) ?? '') === rule.value;
  }

  private clearPoll(): void {
    if (this.pollTimer !== -1) clearTimeout(this.pollTimer);
    this.pollTimer = -1;
  }

  private schedulePoll(): void {
    this.clearPoll();
    const action = this.panel?.pollAction;
    if (!action || !this.alive || !this.layout.foreground) return;
    if (Date.now() >= this.deadline) {
      this.errorMessage = this.t('等待时间过长，可以刷新状态或重新开始。', 'This is taking longer than expected. Refresh or start again.');
      return;
    }
    this.pollTimer = setTimeout((): void => { void this.request(action, true); }, Math.min(4000, this.deadline - Date.now()));
  }

  private async request(action: string = '', polling: boolean = false): Promise<void> {
    if (this.busy || !this.alive || (polling && this.pollingNow)) return;
    if (polling) this.pollingNow = true;
    this.clearPoll();
    const generation = ++this.generation;
    const previous = this.panel?.pollAction;
    const flow = this.panel?.flow;
    const canRecover = this.category === 'connections' && this.itemId.startsWith('conversation:') && flow &&
      (action === 'approve' || action === 'token' || action === 'advance');
    if (!polling) {
      this.busy = true;
      this.errorMessage = '';
      if (action.startsWith('authorize') || action.startsWith('status:') || action.startsWith('status-server:')) {
        this.openWhenReady = true;
      }
    }
    try {
      const url = '/api/capabilities/mobile-actions/panel/' + this.category + '?id=' + encodeURIComponent(this.itemId)
        + '&locale=' + encodeURIComponent(appSettings.effectiveLanguage());
      const values: Record<string, string> = {};
      if (!polling && this.itemId === 'mcp:setup') {
        for (const field of this.panel?.fields ?? []) {
          if (this.isVisible(field.visibleWhen)) values[field.id] = this.values.get(field.id) ?? '';
        }
      } else if (!polling) {
        this.values.forEach((value: string, id: string): void => { values[id] = value; });
      }
      const command: CapabilityPanelCommand = { action, values, flow: this.panel?.flow, revision: this.panel?.revision };
      const raw = await gatewaySession.request(url, action ? 'POST' : 'GET', action ? JSON.stringify(command) : '');
      const result = JSON.parse(raw) as CapabilityPanelEnvelope;
      if (!result.ok || !result.payload) throw new Error(result.error ?? 'CAPABILITY_UNAVAILABLE');
      if (generation !== this.generation) return;
      if (this.panel?.qrUrl !== result.payload.qrUrl) this.qrFeedback = '';
      if (this.panel?.authorizationUrl !== result.payload.authorizationUrl) this.showQr = false;
      if (this.panel?.copyable?.content !== result.payload.copyable?.content) this.copiedBlock = false;
      this.panel = result.payload;
      const actions = result.payload.actions ?? [];
      if (actions.some((entry: CapabilityAction): boolean => entry.dismiss === true) &&
          !actions.some((entry: CapabilityAction): boolean => entry.id === 'add-another')) this.retainedValues.clear();
      const next = new Map<string, string>();
      for (const field of result.payload.fields ?? []) {
        let initial = (polling ? this.values.get(field.id) : undefined) ??
          (field.retain ? this.retainedValues.get(field.id) : undefined) ?? (field.type === 'secret' ? '' : field.value ?? '');
        if (!this.appliedInitial && !action && !initial) {
          if (field.id === 'id' && this.initialId) initial = this.initialId;
          else if (field.id === 'url' && this.initialUrl) initial = this.initialUrl;
        }
        next.set(field.id, initial);
      }
      if (!action) this.appliedInitial = true;
      this.values = next;
      if (!polling) this.newGroup = '';
      this.errorMessage = '';
      if (!polling || previous !== result.payload.pollAction) this.deadline = Date.now() + 300000;
      if (this.openWhenReady && result.payload.authorizationUrl) {
        this.openWhenReady = false;
        void this.authorize(result.payload.authorizationUrl);
      }
      if (this.itemId === 'mcp:setup') {
        if (action === 'save' && actions.some((entry: CapabilityAction): boolean => entry.dismiss === true)) this.onChanged();
      } else if ((!polling && action && action !== 'search') || (polling && previous && !result.payload.pollAction)) {
        this.onChanged();
      }
    } catch (error) {
      if (!polling && generation === this.generation) {
        if (canRecover && (!(error instanceof XopcHttpError) || error.status >= 500)) {
          this.panel = { flow, pollAction: 'check', message: this.t('正在查询连接结果…', 'Checking the connection result…') };
          this.values = new Map<string, string>();
          this.deadline = Date.now() + 300000;
          return;
        }
        this.errorMessage = this.t('暂时无法完成，请重试。', 'Could not complete this action. Try again.');
        if (error instanceof XopcHttpError) {
          try {
            const detail = JSON.parse(error.body) as CapabilityPanelEnvelope;
            if (typeof detail.error === 'string') this.errorMessage = detail.error;
          } catch (_) {}
        }
      }
    } finally {
      if (polling) this.pollingNow = false;
      if (generation === this.generation) {
        this.busy = false;
        this.schedulePoll();
      }
    }
  }

  private async perform(action: CapabilityAction): Promise<void> {
    if (this.busy) return;
    if (action.dismiss) {
      this.onClose();
      return;
    }
    if (action.confirmation && !action.inlineReview) {
      try {
        const result = await this.getUIContext().getPromptAction().showDialog({
          title: action.label, message: action.confirmation,
          buttons: [{ text: this.t('取消', 'Cancel'), color: this.colors.secondary },
            { text: this.t('确认', 'Confirm'), color: this.colors.accent }]
        });
        if (result.index !== 1) return;
      } catch (_) { return; }
    }
    this.getUIContext().getFocusController().clearFocus();
    await this.request(action.id);
  }

  private async authorize(raw: string): Promise<void> {
    const url = raw.startsWith('https://') ? markdownLink(raw) : '';
    if (!url) return;
    try {
      await (this.getUIContext().getHostContext() as common.UIAbilityContext).openLink(url, { appLinkingOnly: false });
      this.openedUrl = url;
    }
    catch (_) { this.errorMessage = this.t('无法打开授权页面，请重试。', 'Could not open sign-in. Try again.'); }
  }

  private authorizationLabel(): string {
    if (this.openedUrl && this.openedUrl === this.panel?.authorizationUrl) {
      return this.t('重新打开授权页', 'Reopen authorization');
    }
    return this.panel?.deviceVerificationCode ? this.t('打开验证页', 'Open verification page') : this.t('前往授权', 'Open authorization');
  }

  private async copyVerificationCode(): Promise<void> {
    const code = this.panel?.deviceVerificationCode;
    if (!code) return;
    try {
      await pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, code));
    } catch (_) { this.errorMessage = this.t('无法复制验证码。', 'Could not copy the verification code.'); }
  }

  private async saveQr(): Promise<void> {
    const qrUrl = this.panel?.qrUrl;
    if (!qrUrl || this.savingQr || !this.alive) return;
    if (this.panel?.expiresAt && Date.now() >= this.panel.expiresAt) {
      this.qrFeedback = this.t('二维码已过期，请刷新状态。', 'The QR code expired. Refresh its status.');
      return;
    }
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    const title = 'xopc-qr-' + Date.now();
    const path = context.cacheDir + '/' + title + '.png';
    this.savingQr = true;
    try {
      const snapshot = await this.getUIContext().getComponentSnapshot().createFromBuilder((): void => {
        this.qrTile(qrUrl);
      });
      const packer = image.createImagePacker();
      let data: ArrayBuffer;
      try {
        data = await packer.packToData(snapshot, { format: 'image/png', quality: 100 });
      } finally {
        await snapshot.release();
        await packer.release();
      }
      if (!this.alive || this.panel?.qrUrl !== qrUrl) return;
      await this.writeQr(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC, data);
      const destination = await photoAccessHelper.getPhotoAccessHelper(context).showAssetsCreationDialog(
        [fileUri.getUriFromPath(path)], [{ title, fileNameExtension: 'png', photoType: photoAccessHelper.PhotoType.IMAGE }]);
      if (destination.length === 0) return;
      await this.writeQr(destination[0], fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC, data);
      if (this.alive && this.panel?.qrUrl === qrUrl) this.qrFeedback = this.t('已保存到相册。', 'Saved to Photos.');
    } catch (_) {
      if (this.alive && this.panel?.qrUrl === qrUrl) {
        this.qrFeedback = this.t('未能保存二维码，请重试。', 'Could not save the QR code. Try again.');
      }
    } finally {
      try { await fs.unlink(path); } catch (_) {}
      this.savingQr = false;
    }
  }

  private async writeQr(path: string, mode: number, data: ArrayBuffer): Promise<void> {
    const file = await fs.open(path, mode);
    try {
      if (await fs.write(file.fd, data) !== data.byteLength) throw new Error('INCOMPLETE_QR_WRITE');
    } finally { await fs.close(file); }
  }

  private selectedOption(field: CapabilityField): number {
    return Math.max(0, (field.options ?? []).findIndex((option: CapabilityChoice): boolean => option.id === this.values.get(field.id)));
  }

  private panelStepsList(): string[] {
    return (this.panel?.steps ?? []).filter((step: string): boolean => step.trim().length > 0);
  }

  private visibleCopyable(): CapabilityPanelCopyable | undefined {
    const block = this.panel?.copyable;
    if (!block || !block.content || !this.isVisible(block.visibleWhen)) return undefined;
    return block;
  }

  private visibleLinks(): CapabilityPanelLink[] {
    return (this.panel?.links ?? []).filter((link: CapabilityPanelLink): boolean =>
      this.isVisible(link.visibleWhen) && Boolean(link.label.trim()) && link.url.startsWith('https://') && Boolean(markdownLink(link.url)));
  }

  private async copyBlock(content: string): Promise<void> {
    if (!content) return;
    try {
      await pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, content));
      this.copiedBlock = true;
    } catch (_) {
      this.errorMessage = this.t('无法复制内容。', 'Could not copy content.');
    }
  }

  private async openPanelLink(raw: string): Promise<void> {
    const url = raw.startsWith('https://') ? markdownLink(raw) : '';
    if (!url) return;
    try {
      await (this.getUIContext().getHostContext() as common.UIAbilityContext).openLink(url, { appLinkingOnly: false });
    } catch (_) {
      this.errorMessage = this.t('无法打开链接，请重试。', 'Could not open the link. Try again.');
    }
  }

  @Builder
  private panelSteps() {
    if (this.panelStepsList().length > 0) {
      Column({ space: 8 }) {
        ForEach(this.panelStepsList(), (step: string, index: number) => {
          Row({ space: 8 }) {
            if (this.panelStepsList().length > 1) {
              Text((index + 1) + '.').fontSize(13).fontWeight(600).fontColor(this.colors.accent)
            }
            Text(step).fontSize(13).fontColor(this.colors.secondary).layoutWeight(1)
          }.width('100%').alignItems(VerticalAlign.Top)
        }, (step: string, index: number): string => index + ':' + step)
      }.id('capability-panel-steps').width('100%').padding(14).backgroundColor(this.colors.panel)
        .borderRadius(this.colors.corner(16)).alignItems(HorizontalAlign.Start)
    }
  }

  @Builder
  private panelCopyable() {
    if (this.visibleCopyable()) {
      Column({ space: 8 }) {
        Row({ space: 8 }) {
          Text(this.visibleCopyable()?.label ?? '').fontSize(14).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground).layoutWeight(1)
          Button(this.copiedBlock ? this.t('已复制', 'Copied') : this.t('复制', 'Copy'))
            .id('capability-panel-copy-block').height(36).backgroundColor(this.colors.input)
            .fontColor(this.colors.chat.action).enabled(!this.busy)
            .onClick((): void => { void this.copyBlock(this.visibleCopyable()?.content ?? ''); })
        }.width('100%')
        Scroll() {
          Text(this.visibleCopyable()?.content ?? '').fontSize(12).fontFamily('monospace')
            .fontColor(this.colors.foreground).width('100%').copyOption(CopyOptions.LocalDevice)
        }.width('100%').constraintSize({ maxHeight: 136 }).padding(10)
          .backgroundColor(this.colors.input).borderRadius(this.colors.corner(12))
        if (this.visibleCopyable()?.note) {
          Text(this.visibleCopyable()?.note ?? '').fontSize(12).fontColor(this.colors.secondary).width('100%')
        }
      }.id('capability-panel-copyable').width('100%').padding(14).backgroundColor(this.colors.panel)
        .borderRadius(this.colors.corner(16)).alignItems(HorizontalAlign.Start)
    }
  }

  @Builder
  private panelLinks() {
    if (this.visibleLinks().length > 0) {
      Column({ space: 8 }) {
        ForEach(this.visibleLinks(), (link: CapabilityPanelLink) => {
          Button() {
            Row({ space: 8 }) {
              Text(link.label).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.chat.action).layoutWeight(1)
              SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.chat.action]).accessibilityLevel('no')
            }.width('100%').padding({ left: 14, right: 14 })
          }.width('100%').height(44).padding(0).backgroundColor(this.colors.panel)
            .borderRadius(this.colors.corner(14)).enabled(!this.busy)
            .onClick((): void => { void this.openPanelLink(link.url); })
        }, (link: CapabilityPanelLink): string => link.url + ':' + link.label)
      }.id('capability-panel-links').width('100%')
    }
  }

  @Builder
  field(field: CapabilityField) {
    Column({ space: 6 }) {
      if (field.presentation === 'segmented') {
        Row({ space: 4 }) {
          ForEach(field.options ?? [], (option: CapabilityChoice) => {
            Button() {
              Text(option.label).fontSize(14).fontWeight(FontWeight.Medium).textAlign(TextAlign.Center)
                .fontColor(this.values.get(field.id) === option.id ? this.colors.accent : this.colors.secondary)
            }.id('capability-option-' + option.id).layoutWeight(1).constraintSize({ minHeight: 44 }).padding(4)
              .backgroundColor(this.values.get(field.id) === option.id ? this.colors.surface : Color.Transparent)
              .borderRadius(this.colors.corner(10)).accessibilitySelected(this.values.get(field.id) === option.id)
              .enabled(!this.busy).onClick((): void => { this.setField(field, option.id); })
          }, (option: CapabilityChoice): string => option.id)
        }.id('capability-field-' + field.id).width('100%').padding(4)
          .backgroundColor(this.colors.input).borderRadius(this.colors.corner(14))
      } else if (field.type === 'toggle') {
        Row({ space: 12 }) {
          Text(field.label).layoutWeight(1).fontColor(this.colors.foreground)
          Toggle({ type: ToggleType.Switch, isOn: this.values.get(field.id) === 'true' })
            .accessibilityText(field.label).enabled(!this.busy)
            .onChange((enabled: boolean): void => { this.set(field.id, String(enabled)); })
        }.width('100%').padding(12).backgroundColor(this.colors.input).borderRadius(this.colors.corner(14))
      } else {
        Row({ space: 4 }) {
          Text(field.label).fontSize(14).fontColor(this.colors.foreground)
          if (field.required) {
            Text('*').fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
          }
        }.width('100%')
        if (field.type === 'headers') {
          XopcCapabilityKeyValueEditor({ encoded: this.values.get(field.id) ?? '', locked: this.busy,
            isEnvironment: field.id === 'mcp-env',
            keyLabel: field.keyLabel ?? '', valueLabel: field.valueLabel ?? '',
            keyPlaceholder: field.keyPlaceholder ?? '', addLabel: field.addLabel ?? '',
            maxItems: field.maxItems ?? 0,
            onUpdate: (text: string): void => { this.setField(field, text); } })
        } else if (field.type === 'list') {
          this.groupList(field)
        } else if (field.type === 'multiline') {
          TextArea({ text: this.values.get(field.id) ?? '', placeholder: field.hint ?? '' })
            .id('capability-field-' + field.id).width('100%').height(field.format === 'json' || field.id === 'mcp-json' ? 144 : 96)
            .maxLength(field.format === 'json' || field.id === 'mcp-json' ? 32768 : field.id === 'args' ? 8192 : 2000)
            .fontFamily(field.format === 'json' || field.id === 'mcp-json' ? 'monospace' : 'HarmonyOS Sans')
            .backgroundColor(this.colors.input).fontColor(this.colors.foreground).enabled(!this.busy).borderRadius(this.colors.corner(14))
            .onChange((value: string): void => { this.setField(field, value); })
        } else if (field.type === 'select') {
          Select((field.options ?? []).map((option: CapabilityChoice): SelectOption => ({ value: option.label })))
            .selected(this.selectedOption(field)).value(field.options?.[this.selectedOption(field)]?.label ?? '')
            .id('capability-field-' + field.id).width('100%').backgroundColor(this.colors.input).fontColor(this.colors.foreground)
            .optionBgColor(this.colors.panel).optionFontColor(this.colors.foreground).enabled(!this.busy)
            .onSelect((index: number): void => { this.set(field.id, field.options?.[index]?.id ?? ''); })
        } else {
          TextInput({ text: this.values.get(field.id) ?? '', placeholder: field.hint ?? '' })
            .id('capability-field-' + field.id).width('100%').height(46).maxLength(8192)
            .type(field.type === 'secret' ? InputType.Password : field.format === 'url' ? InputType.URL : InputType.Normal)
            .enterKeyType(field.id === 'query' ? EnterKeyType.Search : EnterKeyType.Done)
            .backgroundColor(this.colors.input).fontColor(this.colors.foreground).enabled(!this.busy).borderRadius(this.colors.corner(14))
            .onSubmit((): void => {
              if (field.id === 'query') {
                this.getUIContext().getFocusController().clearFocus();
                void this.request('search');
              }
            })
            .onChange((value: string): void => { this.set(field.id, value); })
        }
      }
      if (field.description) {
        Text(field.description).fontSize(12).fontColor(this.colors.secondary).width('100%')
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  private groupIds(id: string): string[] {
    return Array.from(new Set<string>((this.values.get(id) ?? '').split('\n').filter((value: string): boolean => value.trim().length > 0)));
  }

  private addGroup(id: string): void {
    const value = this.newGroup.trim();
    if (!value || /[,\r\n]/.test(value)) return;
    const groups = this.groupIds(id);
    if (!groups.includes(value)) this.set(id, groups.concat([value]).join('\n'));
    this.newGroup = '';
  }

  @Builder
  groupList(field: CapabilityField) {
    Column({ space: 6 }) {
      ForEach(this.groupIds(field.id), (group: string) => {
        Row({ space: 8 }) {
          Text(group).fontSize(14).fontColor(this.colors.foreground).layoutWeight(1)
          Button(this.t('移除', 'Remove')).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.chat.action)
            .accessibilityText(this.t('移除 ', 'Remove ') + group)
            .onClick((): void => { this.set(field.id, this.groupIds(field.id).filter((item: string): boolean => item !== group).join('\n')); })
        }.width('100%')
      }, (group: string): string => group)
      Row({ space: 8 }) {
        TextInput({ text: this.newGroup, placeholder: field.hint ?? '' }).layoutWeight(1).height(44).maxLength(160)
          .enabled(!this.busy).onChange((value: string): void => { this.newGroup = value; })
          .onSubmit((): void => { this.addGroup(field.id); })
        Button(field.addLabel || this.t('添加项目', 'Add item')).height(44).enabled(!this.busy && this.newGroup.trim().length > 0)
          .backgroundColor(this.colors.accentSoft).fontColor(this.colors.chat.action).onClick((): void => { this.addGroup(field.id); })
      }.width('100%')
    }.width('100%').id('capability-field-' + field.id).padding(8).backgroundColor(this.colors.input)
      .borderRadius(this.colors.corner(14))
  }

  private fields(advanced: boolean): CapabilityField[] {
    return (this.panel?.fields ?? []).filter((field: CapabilityField): boolean => (field.advanced === true) === advanced &&
      this.isVisible(field.visibleWhen));
  }

  private actions(advanced: boolean): CapabilityAction[] {
    return (this.panel?.actions ?? []).filter((action: CapabilityAction): boolean =>
      (action.advanced === true) === advanced && this.isVisible(action.visibleWhen));
  }

  @Builder
  actionButton(action: CapabilityAction, primary: boolean) {
    Button(action.label).id('capability-panel-' + action.id).width('100%').height(46)
      .backgroundColor(primary ? this.colors.accent : Color.Transparent)
      .fontColor(primary ? this.colors.onAccent : action.id === 'pair-cancel' ? this.colors.secondary : this.colors.chat.action)
      .enabled(!this.busy)
      .onClick((): void => { void this.perform(action); })
  }

  @Builder
  resultRow(result: CapabilitySearchResult) {
    Row({ space: 12 }) {
      XopcCapabilityLogo({ category: 'skills', iconUrl: result.iconUrl ?? '', label: result.name, extent: 40 })
      Column({ space: 4 }) {
        Text(result.name).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (result.summary) Text(result.summary).fontSize(13).fontColor(this.colors.secondary)
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(result.source).fontSize(12).fontColor(this.colors.secondary)
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      if (result.action) {
        Button(result.action.label).id('capability-panel-' + result.action.id).height(44)
          .backgroundColor(this.colors.accentSoft).fontColor(this.colors.chat.action).enabled(!this.busy)
          .onClick((): void => { if (result.action) void this.perform(result.action); })
      } else {
        Text(this.t('已安装', 'Installed')).fontSize(13).fontColor(this.colors.secondary)
      }
    }.width('100%').padding(14).backgroundColor(this.colors.panel).borderRadius(this.colors.corner(16))
  }

  @Builder
  panelHeader() {
    Row({ space: 10 }) {
      if (this.category === 'agents') {
        XopcPersonalAgentAvatar({ agentId: this.itemId, extent: 44, compact: true, activePage: false,
          appearance: this.appearance, revision: this.avatarRevision,
          avatarReference: this.avatarReference, fallbackLabel: this.itemName })
      } else {
        XopcCapabilityLogo({ category: this.category, iconUrl: this.iconUrl, extent: 44,
          label: this.itemId === 'marketplace:search' || this.itemId === 'mcp:setup' ? '' : this.itemName })
      }
      Text(this.itemName).fontSize(20).fontWeight(FontWeight.Bold)
        .fontColor(this.colors.foreground).layoutWeight(1).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.xmark')).fontSize(18).fontColor([this.colors.foreground])
      }.id('capability-panel-close').width(44).height(44).padding(0).backgroundColor(this.colors.input)
        .accessibilityText($r('app.string.close')).onClick(this.onClose)
    }.width('100%').padding({ left: 20, right: 20, top: 10, bottom: 14 })
  }

  private readyPrompt(): string {
    if (this.panel?.pollAction || this.errorMessage || !this.panel?.chatPrompt) return '';
    const changed = (this.panel.fields ?? []).some((field: CapabilityField): boolean =>
      (this.values.get(field.id) ?? '') !== (field.type === 'secret' ? '' : field.value ?? ''));
    return changed ? '' : this.panel.chatPrompt;
  }

  private primaryAction(): CapabilityAction | undefined {
    if (this.readyPrompt() || this.panel?.authorizationUrl || this.panel?.qrUrl || this.panel?.pollAction) return undefined;
    return this.actions(false)[0];
  }

  private cancelPairing(): CapabilityAction | undefined {
    return this.actions(false).find((action: CapabilityAction): boolean => action.id === 'pair-cancel');
  }

  @Builder
  private panelFooter() {
    if (this.readyPrompt() || this.primaryAction() || this.panel?.authorizationUrl || this.panel?.qrUrl || this.cancelPairing()) {
      Column({ space: 4 }) {
        if (this.readyPrompt()) {
          Button(this.itemId.startsWith('conversation:') ? this.t('返回对话', 'Back to chat') : this.t('通过对话使用', 'Use in chat'))
            .id('capability-use-in-chat').width('100%').height(48).fontSize(16)
            .backgroundColor(this.colors.accent).fontColor(this.colors.onAccent).enabled(!this.busy)
            .onClick((): void => {
              const prompt = this.readyPrompt();
              if (!prompt) return;
              if (this.itemId.startsWith('conversation:')) this.onClose();
              else this.onUseInChat(prompt);
            })
        } else if (this.panel?.authorizationUrl) {
          Button(this.authorizationLabel()).id('capability-panel-open-authorization').width('100%').height(48)
            .backgroundColor(this.colors.accent).fontColor(this.colors.onAccent).enabled(!this.busy)
            .onClick((): void => { void this.authorize(this.panel?.authorizationUrl ?? ''); })
        } else if (this.panel?.qrUrl) {
          this.qrSaveAction(true)
        } else if (this.primaryAction()) {
          ForEach(this.actions(false).slice(0, 1),
            (action: CapabilityAction) => { this.actionButton(action, true) },
            (action: CapabilityAction): string => action.id)
        }
        if (this.cancelPairing() && this.cancelPairing()?.id !== this.primaryAction()?.id) {
          this.actionButton(this.cancelPairing()!, false)
        }
      }.width('100%').padding({ left: 20, right: 20, top: 10, bottom: 12 }).backgroundColor(this.colors.surface)
    }
  }

  @Builder
  private qrTile(payload: string) {
    Row() {
      QRCode(payload).width(156).height(156).color(Color.Black).backgroundColor(Color.White)
    }.padding(16).backgroundColor(Color.White).borderRadius(this.colors.corner(16))
  }

  @Builder
  private qrSaveAction(primary: boolean) {
    Button(this.savingQr ? this.t('正在保存…', 'Saving…') : this.t('保存二维码', 'Save QR code'))
      .id('capability-panel-save-qr').width('100%').height(48)
      .backgroundColor(primary ? this.colors.accent : this.colors.input)
      .fontColor(primary ? this.colors.onAccent : this.colors.chat.action)
      .enabled(!this.busy && !this.savingQr).onClick((): void => { void this.saveQr(); })
    if (this.qrFeedback) {
      Text(this.qrFeedback).fontSize(13).fontColor(this.colors.secondary).width('100%').textAlign(TextAlign.Center)
    }
  }

  @Builder
  private setupOptions() {
    if (this.panel?.authorizationUrl && this.panel?.deviceVerificationCode) {
      Row({ space: 12 }) {
        Column({ space: 4 }) {
          Text(this.t('验证码', 'Verification code')).fontSize(12).fontColor(this.colors.secondary)
          Text(this.panel.deviceVerificationCode).fontFamily('monospace')
            .fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Button(this.t('复制', 'Copy')).height(44).backgroundColor(this.colors.input).fontColor(this.colors.chat.action)
          .enabled(!this.busy).onClick((): void => { void this.copyVerificationCode(); })
      }.width('100%').padding({ left: 14, right: 14, top: 8, bottom: 8 }).backgroundColor(this.colors.panel)
        .borderRadius(this.colors.corner(16))
    }
    if (this.panel?.authorizationUrl && this.panel?.qrUrl) {
      Button() {
        Row({ space: 10 }) {
          Text(this.showQr ? this.t('收起二维码', 'Hide QR code') : this.t('其他方式', 'Other ways'))
            .layoutWeight(1).fontSize(14).fontColor(this.colors.chat.action)
          SymbolGlyph(this.showQr ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
            .fontSize(14).fontColor([this.colors.chat.action]).accessibilityLevel('no')
        }.width('100%').padding({ left: 14, right: 14 })
      }.id('capability-panel-other-methods').width('100%').height(44).padding(0)
        .borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel).accessibilitySelected(this.showQr)
        .enabled(!this.busy).onClick((): void => { this.showQr = !this.showQr; })
    }
    if (this.panel?.qrUrl && (!this.panel.authorizationUrl || this.showQr)) {
      Column({ space: 12 }) {
        Row() {
          this.qrTile(this.panel.qrUrl)
        }.id('capability-panel-qr').accessibilityText(this.t('授权二维码', 'Authorization QR code'))
        Text(this.t('从扫一扫的相册入口选图，或用另一台设备扫码。',
          'Select the saved image if the scanner supports Photos, or scan with another device.'))
          .fontSize(13).fontColor(this.colors.secondary).width('100%').textAlign(TextAlign.Center)
        if (this.panel.authorizationUrl) this.qrSaveAction(false)
      }.width('100%').padding(16).backgroundColor(this.colors.panel).borderRadius(this.colors.corner(16))
    }
  }

  private disclosureLabel(isAdvanced: boolean): string {
    return isAdvanced
      ? this.panel?.advancedLabel ?? this.t('更多选项', 'More options')
      : this.panel?.detailsLabel ?? this.t('查看详情', 'View details');
  }

  @Builder
  private mcpDisclosure(isAdvanced: boolean) {
    Button() {
      Row({ space: 8 }) {
        Text(this.disclosureLabel(isAdvanced)).layoutWeight(1).fontSize(14).fontColor(this.colors.foreground)
        SymbolGlyph((isAdvanced ? this.advanced : this.detailsOpen) ? $r('sys.symbol.chevron_down') : $r('sys.symbol.chevron_right'))
          .fontSize(14).fontColor([this.colors.secondary]).accessibilityLevel('no')
      }.width('100%').padding({ left: 14, right: 14 })
    }.id(isAdvanced ? 'capability-panel-more' : 'capability-panel-review-details')
      .width('100%').height(44).padding(0).backgroundColor(Color.Transparent).enabled(!this.busy)
      .accessibilityText(this.disclosureLabel(isAdvanced)).accessibilitySelected(isAdvanced ? this.advanced : this.detailsOpen)
      .onClick((): void => {
        this.getUIContext().getFocusController().clearFocus();
        if (isAdvanced) this.advanced = !this.advanced; else this.detailsOpen = !this.detailsOpen;
      })
  }

  @Builder
  private panelDetails() {
    if (this.panel?.details) {
      Column({ space: 6 }) {
        if (this.itemId === 'mcp:setup') {
          this.mcpDisclosure(false)
        } else {
          Button(this.detailsOpen ? this.t('收起详情', 'Hide details') : this.disclosureLabel(false))
            .id('capability-panel-review-details').height(44).backgroundColor(Color.Transparent)
            .fontColor(this.colors.chat.action).onClick((): void => { this.detailsOpen = !this.detailsOpen; })
        }
        if (this.detailsOpen) {
          Text(this.panel?.details).fontSize(13).fontColor(this.colors.secondary).width('100%')
            .padding({ left: this.itemId === 'mcp:setup' ? 14 : 0, right: this.itemId === 'mcp:setup' ? 14 : 0 })
        }
      }.width('100%').padding({ left: this.itemId === 'mcp:setup' ? 0 : 12, right: this.itemId === 'mcp:setup' ? 0 : 12,
        bottom: this.detailsOpen ? 12 : 0 })
        .alignItems(HorizontalAlign.Start).backgroundColor(this.colors.panel).borderRadius(this.colors.corner(14))
    }
  }

  @Builder
  panelBody() {
    Scroll() {
      Column({ space: 14 }) {
        if (this.panel?.headline || this.panel?.subtitle) {
          Column({ space: 4 }) {
            if (this.panel?.headline) {
              Text(this.panel.headline).fontSize(20).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
            }
            if (this.panel?.subtitle) {
              Text(this.panel.subtitle).fontSize(13).fontColor(this.colors.secondary).width('100%')
            }
          }.width('100%').padding({ left: 4, right: 4 })
        }
        if (this.panel?.message || this.readyPrompt() || this.panel?.pollAction) {
          Row({ space: 10 }) {
            if (this.panel?.pollAction) {
              Text('').width(8).height(8).borderRadius(4).backgroundColor(this.colors.accent).accessibilityLevel('no')
            } else if (this.readyPrompt() || this.panel?.tone === 'success') {
              SymbolGlyph($r('sys.symbol.checkmark_circle')).fontSize(20).fontColor([this.colors.success])
            }
            Text(this.panel?.message || this.t('可在对话中使用', 'Ready to use in chat')).fontSize(14)
              .fontColor(this.colors.foreground).layoutWeight(1)
          }.id('capability-panel-status').width('100%').padding({ left: 14, right: 14, top: 12, bottom: 12 })
            .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(16))
        } else if (this.panel && this.description && this.category !== 'agents') {
          Text(this.description).fontSize(14).fontColor(this.colors.secondary).width('100%')
        }
        this.panelSteps()
        this.panelCopyable()
        this.panelLinks()
        if (this.panel?.reviewText) {
          Text(this.panel.reviewText).id('capability-panel-review-text').width('100%').padding(14)
            .fontSize(13).fontFamily('monospace').fontColor(this.colors.foreground)
            .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(16))
        }
        if (this.busy && this.panel) LoadingProgress().width(22).height(22).color(this.colors.accent)
        if (!this.panel && !this.errorMessage) { XopcListSkeleton() }
        if (this.errorMessage) {
          Text(this.errorMessage).fontSize(14).fontColor(this.colors.danger).width('100%')
          if (!this.panel) Button(this.t('重试', 'Retry')).enabled(!this.busy).onClick((): void => { void this.request(); })
          if (this.panel?.pollAction) Button(this.t('刷新状态', 'Refresh status')).enabled(!this.busy)
            .onClick((): void => { if (this.panel?.pollAction) void this.request(this.panel.pollAction); })
        }
        this.setupOptions()
        if (this.itemId !== 'mcp:setup') this.panelDetails()
        if (this.fields(false).length) {
          Column({ space: 14 }) {
            ForEach(this.fields(false), (entry: CapabilityField) => { this.field(entry) },
              (entry: CapabilityField): string => entry.id)
          }.width('100%').padding(14).backgroundColor(this.colors.panel).borderRadius(this.colors.corner(16))
        }
        if (this.itemId === 'mcp:setup') this.panelDetails()
        ForEach(this.actions(false).filter((action: CapabilityAction): boolean =>
          action.id !== this.primaryAction()?.id && action.id !== this.cancelPairing()?.id),
          (action: CapabilityAction) => { this.actionButton(action, false) }, (action: CapabilityAction): string => action.id)
        ForEach(this.panel?.results ?? [], (entry: CapabilitySearchResult) => { this.resultRow(entry) },
          (entry: CapabilitySearchResult): string => entry.id)
        if (this.fields(true).length || this.actions(true).length) {
          Column({ space: 10 }) {
            if (this.itemId === 'mcp:setup') {
              this.mcpDisclosure(true)
            } else {
              Button(this.advanced ? this.t('收起选项', 'Fewer options') : this.disclosureLabel(true))
                .id('capability-panel-more').height(44).backgroundColor(Color.Transparent).fontColor(this.colors.chat.action)
                .accessibilitySelected(this.advanced).onClick((): void => { this.advanced = !this.advanced; })
            }
            if (this.advanced) {
              Column({ space: 10 }) {
                ForEach(this.fields(true), (field: CapabilityField) => { this.field(field) },
                  (field: CapabilityField): string => field.id)
                ForEach(this.actions(true), (action: CapabilityAction) => { this.actionButton(action, false) },
                  (action: CapabilityAction): string => action.id)
              }.width('100%').alignItems(HorizontalAlign.Start).padding(this.itemId === 'mcp:setup' ? { left: 14, right: 14, bottom: 14 } : 0)
            }
          }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: this.itemId === 'mcp:setup' ? 0 : 12,
            right: this.itemId === 'mcp:setup' ? 0 : 12 })
            .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(14))
        }
      }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 20, right: 20, top: 4, bottom: 12 })
    }.width('100%').layoutWeight(1).align(Alignment.Top).scrollBar(BarState.Auto)
  }

  build() {
    Column() {
      this.panelHeader()
      this.panelBody()
      this.panelFooter()
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
  }
}

interface CapabilityRequestHeaderRow {
  id: number;
  headerName: string;
  headerValue: string;
}

@ComponentV2
struct XopcCapabilityKeyValueEditor {
  @Param encoded: string = '';
  @Param locked: boolean = false;
  @Param isEnvironment: boolean = false;
  @Param keyLabel: string = '';
  @Param valueLabel: string = '';
  @Param keyPlaceholder: string = '';
  @Param addLabel: string = '';
  @Param maxItems: number = 0;
  @Event onUpdate: (text: string) => void = (_text: string): void => {};
  @Local rows: CapabilityRequestHeaderRow[] = [];
  @Local colors: XopcThemeColors = appThemeColors;
  private nextId: number = 0;

  aboutToAppear(): void { this.restore(); }

  @Monitor('encoded')
  onEncodedChange(): void {
    if (!this.encoded) this.restore();
  }

  private t(zh: string, en: string): string {
    return appSettings.effectiveLanguage().startsWith('zh') ? zh : en;
  }

  private resolvedKeyLabel(): string {
    return this.keyLabel || (this.isEnvironment ? this.t('变量名', 'Variable name') : this.t('请求头名称', 'Header name'));
  }

  private resolvedValueLabel(): string {
    return this.valueLabel || (this.isEnvironment ? this.t('变量值', 'Variable value') : this.t('请求头值', 'Header value'));
  }

  private resolvedKeyPlaceholder(): string {
    return this.keyPlaceholder || (this.isEnvironment ? 'API_KEY' : 'X-API-Key');
  }

  private resolvedAddLabel(): string {
    return this.addLabel || (this.isEnvironment ? this.t('添加变量', 'Add variable') : this.t('添加请求头', 'Add header'));
  }

  private resolvedMaxItems(): number {
    return this.maxItems > 0 ? this.maxItems : (this.isEnvironment ? 32 : 16);
  }

  private restore(): void {
    const rows = this.encoded ? JSON.parse(this.encoded) as string[][] : [];
    this.rows = rows.map((row: string[]): CapabilityRequestHeaderRow => ({
      id: this.nextId++, headerName: row[0], headerValue: row[1],
    }));
    if (!this.rows.length) this.rows = [{ id: this.nextId++, headerName: '', headerValue: '' }];
  }

  private write(rows: CapabilityRequestHeaderRow[]): void {
    this.rows = rows;
    this.onUpdate(JSON.stringify(rows.map((row: CapabilityRequestHeaderRow): string[] => [row.headerName, row.headerValue])));
  }

  private update(id: number, text: string, editingName: boolean): void {
    this.write(this.rows.map((row: CapabilityRequestHeaderRow): CapabilityRequestHeaderRow => {
      if (row.id !== id) return row;
      return { id, headerName: editingName ? text : row.headerName, headerValue: editingName ? row.headerValue : text };
    }));
  }

  build() {
    Column({ space: 10 }) {
      ForEach(this.rows, (row: CapabilityRequestHeaderRow) => {
        Row({ space: 4 }) {
          Column({ space: 4 }) {
            TextInput({ text: row.headerName, placeholder: this.resolvedKeyPlaceholder() })
              .accessibilityText(this.resolvedKeyLabel())
              .width('100%').height(44).maxLength(128)
              .backgroundColor(this.colors.input).borderRadius(this.colors.corner(12)).fontColor(this.colors.foreground)
              .enabled(!this.locked).onChange((text: string): void => { this.update(row.id, text, true); })
            TextInput({ text: row.headerValue, placeholder: this.resolvedValueLabel() })
              .accessibilityText(this.resolvedValueLabel())
              .width('100%').height(44).maxLength(4096)
              .type(InputType.Password).backgroundColor(this.colors.input).borderRadius(this.colors.corner(12))
              .fontColor(this.colors.foreground).enabled(!this.locked)
              .onChange((text: string): void => { this.update(row.id, text, false); })
          }.layoutWeight(1)
          if (this.rows.length > 1) {
            Button() {
              SymbolGlyph($r('sys.symbol.xmark')).fontSize(16).fontColor([this.colors.secondary])
            }.accessibilityText(this.isEnvironment ? this.t('移除变量', 'Remove variable') : this.t('移除请求头', 'Remove header'))
              .width(44).height(44).padding(0)
              .backgroundColor(Color.Transparent).enabled(!this.locked)
              .onClick((): void => { this.write(this.rows.filter((item: CapabilityRequestHeaderRow): boolean => item.id !== row.id)); })
          }
        }.width('100%').alignItems(VerticalAlign.Top)
      }, (row: CapabilityRequestHeaderRow): string => String(row.id))
      if (this.rows.length < this.resolvedMaxItems()) {
        Button() {
          Row({ space: 6 }) {
            SymbolGlyph($r('sys.symbol.plus')).fontSize(15).fontColor([this.colors.accent])
            Text(this.resolvedAddLabel()).fontColor(this.colors.accent)
          }
        }.height(44).padding({ left: 4, right: 4 }).backgroundColor(Color.Transparent).enabled(!this.locked)
          .onClick((): void => { this.write(this.rows.concat([{ id: this.nextId++, headerName: '', headerValue: '' }])); })
      }
    }.id(this.isEnvironment ? 'capability-field-mcp-env' : 'capability-field-requestHeaders')
      .width('100%').alignItems(HorizontalAlign.Start)
  }
}
