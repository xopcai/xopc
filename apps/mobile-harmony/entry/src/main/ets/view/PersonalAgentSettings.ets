import { common } from '@kit.AbilityKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { userErrorMessage } from '../common/userError';
import { appSettings } from '../service/settings';
import { gatewaySession } from '../service/gatewaySession';
import { pickChatPhoto } from '../service/chatPhotoPicker';
import { XopcPersonalAgentRecord, XopcPersonalPreferences, XopcPersonalVoiceOption } from '../model/personalAgent';
import { XopcPersonalAgentSettingsViewModel } from '../viewmodel/personalAgentSettingsViewModel';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';
import { XopcListSkeleton } from './MobileComponents';

interface XopcPersonalSettingChoice {
  heading: string;
  options: SelectOption[];
  selectedIndex: number;
  controlId: string;
  available: boolean;
  onSelect: (index: number) => void;
}

@ComponentV2
export struct XopcPersonalAgentSettings {
  @Param record: XopcPersonalAgentRecord | null = null;
  @Event onSaved: (record: XopcPersonalAgentRecord) => void = (_record: XopcPersonalAgentRecord): void => {};
  @Event onClose: () => void = (): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local model: XopcPersonalAgentSettingsViewModel = new XopcPersonalAgentSettingsViewModel();
  @Local assistantName: string = '';
  @Local appearance: string = 'loopi';
  @Local detailLevel: string = 'balanced';
  @Local voiceId: string = '';
  @Local uploading: boolean = false;
  @Local avatarPreview: string = '';

  private label(zh: string, en: string): string { return appSettings.effectiveLanguage().startsWith('zh') ? zh : en; }
  aboutToAppear(): void { void this.reload(); }
  aboutToDisappear(): void { this.model.dispose(); }
  private async reload(): Promise<void> {
    if (!this.record) return;
    await this.model.load(this.record);
    const current = this.model.record;
    if (!current) return;
    this.assistantName = current.displayName; this.appearance = current.appearance;
    this.detailLevel = current.preferences?.detailLevel ?? 'balanced';
    this.voiceId = current.voicePreference?.voice === 'default' ? '' : current.voicePreference?.voice ?? '';
  }
  private async save(): Promise<void> {
    const current = this.model.record?.preferences;
    const prefs: XopcPersonalPreferences = { addressAs: current?.addressAs, detailLevel: this.detailLevel,
      warmth: current?.warmth, supportMode: current?.supportMode, proactivity: current?.proactivity,
      humor: current?.humor, guidance: current?.guidance };
    const updated = await this.model.saveProfile(this.assistantName, this.appearance, prefs, this.voiceId);
    if (updated) { this.onSaved(updated); this.onClose(); }
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
      Row() {
        Text(this.label('配置 ', 'Configure ') + (this.model.record?.displayName?.trim() || this.record?.displayName?.trim() || 'ADA')).fontSize(20).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.foreground).layoutWeight(1)
        Button('×').width(44).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
          .id('personal-setting-close').accessibilityText(this.label('关闭', 'Close'))
          .onClick((): void => { this.onClose(); })
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
              .onChange((text: string): void => { this.assistantName = text; })
            this.settingChoice({ heading: this.label('回答长度', 'Length'),
              options: [{ value: this.label('简短', 'Brief') }, { value: this.label('适中', 'Balanced') }, { value: this.label('详细', 'Detailed') }], selectedIndex: ['brief', 'balanced', 'detailed'].indexOf(this.detailLevel),
              controlId: 'personal-setting-detail', available: true,
              onSelect: (index: number): void => { this.detailLevel = ['brief', 'balanced', 'detailed'][index]; } })
            this.settingChoice({ heading: this.label('通话声音', 'Call voice'), options: this.voiceOptions(),
              selectedIndex: this.availableVoices().findIndex((voice: XopcPersonalVoiceOption): boolean => voice.id === this.voiceId) + 1,
              controlId: 'personal-setting-voice', available: !!this.model.voiceRoute,
              onSelect: (index: number): void => { this.voiceId = index === 0 ? '' : this.availableVoices()[index - 1]?.id ?? ''; } })
            if (this.model.voiceError) { Text(this.model.voiceError).fontColor(this.colors.danger) }
            Text(this.label('更多设置请前往 PC 或 Web 端。', 'For more settings, use the PC or Web app.'))
              .fontSize(13).fontColor(this.colors.secondary).width('100%')
            if (this.model.error) {
              Text(this.model.error.includes('CONFLICT') || this.model.error.includes('HTTP_409')
                ? this.label('设置已在其他地方修改。当前输入已保留，请重新打开设置核对后保存。',
                  'Settings changed elsewhere. Your input is retained; reopen settings to review before saving.')
                : userErrorMessage(this.model.error, 'save'))
                .fontSize(13).fontColor(this.colors.danger).width('100%')
            }
          }.width('100%').padding(20).enabled(!this.model.saving && !this.uploading)
        }.id('personal-settings-scroll').layoutWeight(1).width('100%').align(Alignment.Top).scrollBar(BarState.Auto)
      }
      Button(this.model.saving ? this.label('正在保存…', 'Saving…') : this.model.error ? this.label('重试保存', 'Retry save') : this.label('保存', 'Save'))
        .id('personal-agent-profile-save').width('90%').height(44).margin({ top: 12, bottom: 28 })
        .backgroundColor(this.colors.foreground).fontColor(this.colors.surface)
        .enabled(!this.model.loading && !this.model.saving && !this.uploading && !!this.assistantName.trim())
        .onClick((): void => { void this.save(); })
    }.id('personal-agent-profile-sheet').width('100%').height('100%').backgroundColor(this.colors.panel)
  }
}
