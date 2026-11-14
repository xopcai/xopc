import { common } from '@kit.AbilityKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { userErrorMessage } from '../common/userError';
import { appSettings } from '../service/settings';
import { gatewaySession } from '../service/gatewaySession';
import { pickChatPhoto } from '../service/chatPhotoPicker';
import { XopcPersonalAgentRecord, XopcPersonalCallMode, XopcPersonalVoiceOption } from '../model/personalAgent';
import { XopcPersonalAgentSettingsViewModel } from '../viewmodel/personalAgentSettingsViewModel';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';
import { XopcHubRow, XopcListSkeleton } from './MobileComponents';
import { XopcChatOptionsViewModel } from '../viewmodel/chatOptionsViewModel';
import { XopcChatOptions } from './ChatOptions';

interface XopcPersonalSettingChoice {
  heading: string;
  options: SelectOption[];
  selectedIndex: number;
  controlId: string;
  available: boolean;
  onSelect: (index: number) => void;
}

const PERSONAL_CALL_MODES: XopcPersonalCallMode[] = ['auto', 'natural', 'assistant'];

@ComponentV2
export struct XopcPersonalAgentSettings {
  @Param chatOptions: XopcChatOptionsViewModel = new XopcChatOptionsViewModel();
  @Param modelBusy: boolean = false;
  @Event onReloadModels: () => void = (): void => {};
  @Param record: XopcPersonalAgentRecord | null = null;
  @Event onSaved: (record: XopcPersonalAgentRecord) => void = (_record: XopcPersonalAgentRecord): void => {};
  @Event onClose: () => void = (): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local model: XopcPersonalAgentSettingsViewModel = new XopcPersonalAgentSettingsViewModel();
  @Local assistantName: string = '';
  @Local appearance: string = 'loopi';
  @Local callMode: XopcPersonalCallMode = 'auto';
  @Local voiceExpanded: boolean = false;
  @Local greetingEnabled: boolean = true;
  @Local voiceId: string = '';
  @Local uploading: boolean = false;
  @Local avatarPreview: string = '';
  @Local modelPickerOpen: boolean = false;
  private nameSaveTimer: number = -1;

  private label(zh: string, en: string): string { return appSettings.effectiveLanguage().startsWith('zh') ? zh : en; }
  aboutToAppear(): void { void this.reload(); this.onReloadModels(); }
  aboutToDisappear(): void { clearTimeout(this.nameSaveTimer); this.model.dispose(); }
  private async reload(): Promise<void> {
    if (!this.record) return;
    await this.model.load(this.record);
    const current = this.model.record;
    if (!current) return;
    this.assistantName = current.displayName; this.appearance = current.appearance;
    this.callMode = current.voiceCallPreferences?.enginePreference ?? 'auto';
    this.greetingEnabled = current.voiceCallPreferences?.openingGreetingEnabled ?? true;
    this.voiceId = current.voicePreference?.voice === 'default' ? '' : current.voicePreference?.voice ?? '';
  }
  private scheduleNameSave(): void {
    clearTimeout(this.nameSaveTimer);
    if (!this.assistantName.trim() || this.assistantName.trim() === this.model.record?.displayName) return;
    this.nameSaveTimer = setTimeout((): void => { void this.save(); }, 700);
  }
  private async save(): Promise<void> {
    clearTimeout(this.nameSaveTimer);
    const record = this.model.record;
    if (!record || this.model.loading || this.model.saving) return;
    const name = this.assistantName.trim() || record.displayName;
    const savedVoice = record.voicePreference?.voice === 'default' ? '' : record.voicePreference?.voice ?? '';
    if (name === record.displayName && this.appearance === record.appearance &&
      this.callMode === (record.voiceCallPreferences?.enginePreference ?? 'auto') &&
      this.greetingEnabled === (record.voiceCallPreferences?.openingGreetingEnabled ?? true) && this.voiceId === savedVoice) return;
    const updated = await this.model.saveProfile(name, this.appearance, this.voiceId, this.greetingEnabled, this.callMode);
    if (updated) this.onSaved(updated);
  }
  private async close(): Promise<void> {
    if (this.model.saving || this.uploading) return;
    if (this.model.error) { this.onClose(); return; }
    await this.save();
    if (!this.model.error) this.onClose();
  }
  private async uploadAvatar(): Promise<void> {
    if (this.uploading || !this.model.record) return;
    this.uploading = true; this.model.error = '';
    const connection = gatewaySession.connectionRevision();
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const image = await pickChatPhoto(context, [], false);
      if (!image) return;
      if (!image.data || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType) || image.size > 512 * 1024) {
        throw new Error(this.label('请选择不超过 512 KB 的 PNG、JPEG 或 WebP 图片', 'Choose a PNG, JPEG or WebP image up to 512 KB'));
      }
      await gatewaySession.request('/api/personal-agent/avatar', 'PUT',
        JSON.stringify({ base64: image.data, mimeType: image.mimeType }));
      gatewaySession.assertConnection(connection);
      this.avatarPreview = 'data:' + image.mimeType + ';base64,' + image.data;
      this.appearance = 'custom';
      await this.save();
    } catch (error) { this.model.error = (error as Error).message; }
    finally { this.uploading = false; }
  }

  private availableVoices(): XopcPersonalVoiceOption[] {
    const options = this.model.voices.filter((voice: XopcPersonalVoiceOption): boolean => voice.id !== 'default');
    const current = this.model.record?.voicePreference;
    if (current && current.voice !== 'default' && !options.some((voice: XopcPersonalVoiceOption): boolean => voice.id === current.voice)) {
      options.push({ id: current.voice, name: current.voice });
    }
    return options;
  }
  private voiceOptions(): SelectOption[] {
    const options: SelectOption[] = [{ value: this.label('默认声音', 'Default voice') }];
    return options.concat(this.availableVoices().map((voice: XopcPersonalVoiceOption): SelectOption => { return { value: appSettings.effectiveLanguage().startsWith('zh') ? voice.displayNames?.['zh-CN'] ?? voice.name : voice.displayNames?.['en'] ?? voice.name }; }));
  }

  @Builder
  settingChoice($$: XopcPersonalSettingChoice) {
    Row({ space: 12 }) {
      Text($$.heading).fontSize(14).fontColor(this.colors.foreground).layoutWeight(1)
      Select($$.options).selected($$.selectedIndex)
        .value($$.options[$$.selectedIndex]?.value ?? $$.options[0]?.value ?? '')
        .id($$.controlId).width('58%').height(44).font({ size: 14 })
        .fontColor(this.colors.foreground).backgroundColor(this.colors.input)
        .optionFontColor(this.colors.foreground).optionBgColor(this.colors.panel)
        .selectedOptionFontColor(this.colors.accent).selectedOptionBgColor(this.colors.accentSoft)
        .enabled($$.available).onSelect((index: number): void => { $$.onSelect(index); })
    }.width('100%').constraintSize({ minHeight: 48 })
  }

  build() {
    Column() {
      if (this.modelPickerOpen) {
        XopcChatOptions({ model: this.chatOptions, mode: 'model',
          modelBusy: this.modelBusy, rememberModel: false,
          onClose: (): void => { this.modelPickerOpen = false; },
          onRetry: (): void => { this.onReloadModels(); } })
      } else {
        Row() {
          Blank().layoutWeight(1)
          Button('×').width(44).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
            .id('personal-setting-close').accessibilityText(this.label('关闭', 'Close'))
            .enabled(!this.model.saving && !this.uploading)
            .onClick((): void => { void this.close(); })
        }.width('100%').padding({ left: 20, right: 16, top: 12 })
        if (this.model.loading) { XopcListSkeleton() }
        else {
          Scroll() {
            Column({ space: 12 }) {
              Button({ type: ButtonType.Circle }) {
                if (this.avatarPreview && this.appearance === 'custom') {
                  Image(this.avatarPreview).width(72).height(72).borderRadius(36).objectFit(ImageFit.Cover)
                } else {
                  XopcPersonalAgentAvatar({ agentId: this.record?.agentId ?? '', appearance: this.appearance, extent: 72, revision: this.model.record?.revision ?? 0 })
                }
              }.id('personal-setting-avatar').width(72).height(72).backgroundColor(Color.Transparent)
                .accessibilityText(this.label('上传头像', 'Upload avatar')).enabled(!this.uploading)
                .onClick((): void => { void this.uploadAvatar(); })
              Text(this.label('助手名称', 'Assistant name')).fontSize(13).fontColor(this.colors.secondary).width('100%')
              TextInput({ text: this.assistantName, placeholder: this.label('助手名称', 'Assistant name') }).maxLength(60)
                .id('personal-setting-name').width('100%').height(44).fontSize(15).fontColor(this.colors.foreground).backgroundColor(this.colors.input)
                .onChange((text: string): void => { this.assistantName = text; this.scheduleNameSave(); })
                .onSubmit((): void => { void this.save(); })
              Text(this.label('对话模型', 'Chat model')).fontSize(13).fontColor(this.colors.secondary).width('100%')
              if (this.chatOptions.loading) {
                Text($r('app.string.chat_model')).fontSize(14).fontColor(this.colors.tertiary).width('100%')
              } else {
                XopcHubRow({ heading: $r('app.string.chat_model'),
                  summary: this.chatOptions.modelId ? this.chatOptions.modelName(appSettings.effectiveLanguage()) : '',
                  compact: true, onOpen: (): void => { this.modelPickerOpen = true; } })
                  .id('personal-setting-model').enabled(!this.chatOptions.saving)

              }
              Text(this.label('语音通话', 'Voice calls')).fontSize(13).fontColor(this.colors.secondary).width('100%')
              this.settingChoice({ heading: this.label('通话模式', 'Call mode'), options: [
                { value: this.label('自动选择', 'Automatic') }, { value: this.label('直接对话', 'Direct conversation') },
                { value: this.label('语音助手', 'Voice assistant') }],
                selectedIndex: PERSONAL_CALL_MODES.indexOf(this.callMode), controlId: 'personal-setting-call-mode',
                available: !!this.model.record, onSelect: (index: number): void => {
                  this.callMode = PERSONAL_CALL_MODES[index] ?? 'auto';
                  void this.save();
                } })
              if (this.callMode !== 'natural') {
                XopcHubRow({ heading: this.label('声音与问候', 'Voice and greeting'), compact: true, showChevron: false,
                  symbol: this.voiceExpanded ? $r('sys.symbol.chevron_down') : $r('sys.symbol.chevron_right'),
                  onOpen: (): void => { this.voiceExpanded = !this.voiceExpanded; } }).id('personal-setting-voice-details')
                if (this.voiceExpanded) {
                  if (this.model.record?.voiceCallPreferences) {
                    Row() {
                      Text(this.label('连接时打招呼', 'Greet me when connected')).fontSize(14).fontColor(this.colors.foreground).layoutWeight(1)
                      Toggle({ type: ToggleType.Switch, isOn: this.greetingEnabled })
                        .onChange((enabled: boolean): void => { this.greetingEnabled = enabled; void this.save(); })
                    }.width('100%')
                  }
                  this.settingChoice({ heading: this.label('通话声音', 'Call voice'), options: this.voiceOptions(),
                    selectedIndex: this.availableVoices().findIndex((voice: XopcPersonalVoiceOption): boolean => voice.id === this.voiceId) + 1,
                    controlId: 'personal-setting-voice', available: !!this.model.voiceRoute,
                    onSelect: (index: number): void => { this.voiceId = index === 0 ? '' : this.availableVoices()[index - 1]?.id ?? ''; void this.save(); } })
                  if (this.model.voiceError) { Text(this.model.voiceError).fontColor(this.colors.danger) }
                }
              }
              if (this.model.error) {
                Text(this.model.error.includes('CONFLICT') || this.model.error.includes('HTTP_409')
                  ? this.label('设置已在其他地方修改，请重新打开设置查看最新值。',
                    'Settings changed elsewhere. Reopen settings to review the latest values.')
                  : userErrorMessage(this.model.error, 'save'))
                  .fontSize(13).fontColor(this.colors.danger).width('100%')
                Button(this.label('重试', 'Retry')).fontColor(this.colors.accent).backgroundColor(Color.Transparent)
                  .onClick((): void => { void this.save(); })
              } else if (this.model.saving) {
                Text(this.label('正在保存…', 'Saving…')).fontSize(13).fontColor(this.colors.secondary).width('100%')
              }
            }.width('100%').padding(20).enabled(!this.model.saving && !this.uploading)
          }.id('personal-settings-scroll').layoutWeight(1).width('100%').align(Alignment.Top).scrollBar(BarState.Auto)
        }
      }
    }.id('personal-agent-profile-sheet').width('100%').height('100%').backgroundColor(this.colors.panel)
  }
}
