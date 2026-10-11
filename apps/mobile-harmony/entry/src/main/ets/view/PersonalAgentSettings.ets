import { common } from '@kit.AbilityKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
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
  @Event onModel: () => void = (): void => {};
  @Event onThinking: () => void = (): void => {};
  @Event onActions: () => void = (): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local model: XopcPersonalAgentSettingsViewModel = new XopcPersonalAgentSettingsViewModel();
  @Local assistantName: string = '';
  @Local appearance: string = 'loopi';
  @Local addressAs: string = '';
  @Local warmth: string = 'balanced';
  @Local supportMode: string = 'untangle';
  @Local detailLevel: string = 'balanced';
  @Local proactivity: string = 'decisions';
  @Local humor: string = 'none';
  @Local voiceId: string = '';
  @Local outreachMode: string = 'balanced';
  @Local timezone: string = '';
  @Local quietStart: number = 22;
  @Local quietEnd: number = 8;
  @Local uploading: boolean = false;
  @Local avatarPreview: string = '';
  @Local outreachSaved: boolean = false;

  private label(zh: string, en: string): string { return appSettings.effectiveLanguage().startsWith('zh') ? zh : en; }
  aboutToAppear(): void { void this.reload(); }
  aboutToDisappear(): void { this.model.dispose(); }
  private async reload(): Promise<void> {
    if (!this.record) return;
    this.outreachSaved = false;
    await this.model.load(this.record);
    const current = this.model.record;
    if (!current) return;
    this.assistantName = current.displayName; this.appearance = current.appearance;
    this.addressAs = current.userCallName ?? current.preferences?.addressAs ?? '';
    this.warmth = current.preferences?.warmth ?? 'balanced';
    this.supportMode = current.preferences?.supportMode ?? 'untangle';
    this.detailLevel = current.preferences?.detailLevel ?? 'balanced';
    this.proactivity = current.preferences?.proactivity ?? 'decisions';
    this.humor = current.preferences?.humor ?? 'none'; this.voiceId = current.voicePreference?.voice ?? '';
    const outreach = this.model.outreach;
    if (outreach) { this.outreachMode = outreach.mode; this.timezone = outreach.timezone;
      this.quietStart = outreach.quietStart; this.quietEnd = outreach.quietEnd; }
  }
  private async save(): Promise<void> {
    const prefs: XopcPersonalPreferences = { addressAs: this.addressAs, warmth: this.warmth, supportMode: this.supportMode,
      detailLevel: this.detailLevel, proactivity: this.proactivity, humor: this.humor, guidance: this.model.record?.preferences?.guidance };
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
    const options = this.model.voices.slice();
    const current = this.model.record?.voicePreference;
    if (current && !options.some((voice: XopcPersonalVoiceOption): boolean => voice.id === current.voice)) {
      options.push({ id: current.voice, name: current.voice });
    }
    return options;
  }
  private voiceOptions(): SelectOption[] {
    const options: SelectOption[] = [{ value: this.label('默认声音', 'Default voice') }];
    return options.concat(this.availableVoices().map((voice: XopcPersonalVoiceOption): SelectOption => { return { value: voice.name }; }));
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
        Text(this.label('配置 Personal AI', 'Personal AI settings')).fontSize(20).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.foreground).layoutWeight(1)
        Button('×').width(44).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
          .id('personal-setting-close').accessibilityText(this.label('关闭', 'Close'))
          .onClick((): void => { this.onClose(); })
      }.width('100%').padding({ left: 20, right: 16, top: 12 })
      if (this.model.loading) { XopcListSkeleton() }
      else {
        Scroll() {
          Column({ space: 12 }) {
            if (this.avatarPreview && this.appearance === 'custom') {
              Image(this.avatarPreview).width(72).height(72).borderRadius(36).objectFit(ImageFit.Cover)
            } else {
              XopcPersonalAgentAvatar({ agentId: this.record?.agentId ?? '', appearance: this.appearance, extent: 72, revision: this.model.record?.revision ?? 0 })
            }
            Text(this.label('助手名称', 'Assistant name')).fontSize(13).fontColor(this.colors.secondary).width('100%')
            TextInput({ text: this.assistantName, placeholder: this.label('助手名称', 'Assistant name') }).maxLength(60)
              .id('personal-setting-name').width('100%').height(44).fontSize(15).fontColor(this.colors.foreground).backgroundColor(this.colors.input)
              .onChange((text: string): void => { this.assistantName = text; })
            Text(this.label('怎么称呼你', 'How to address you')).fontSize(13).fontColor(this.colors.secondary).width('100%')
            TextInput({ text: this.addressAs, placeholder: this.label('怎么称呼你', 'How to address you') }).maxLength(60)
              .id('personal-setting-address').width('100%').height(44).fontSize(15).fontColor(this.colors.foreground).backgroundColor(this.colors.input)
              .onChange((text: string): void => { this.addressAs = text; })
            this.settingChoice({ heading: this.label('形象', 'Appearance'),
              options: [{ value: 'Loopi' }, { value: this.label('好奇', 'Curious') }, { value: this.label('温和', 'Gentle') },
              { value: this.label('自定义', 'Custom') }], selectedIndex: ['loopi', 'loopi-curious', 'loopi-care', 'custom'].indexOf(this.appearance),
              controlId: 'personal-setting-appearance', available: true,
              onSelect: (index: number): void => { if (index < 3 || this.record?.appearance === 'custom' || !!this.avatarPreview) this.appearance = ['loopi', 'loopi-curious', 'loopi-care', 'custom'][index]; } })
            Button(this.label('上传头像', 'Upload avatar')).width('100%').height(44)
              .backgroundColor(this.colors.accentSoft).fontColor(this.colors.accent).enabled(!this.uploading).onClick((): void => { void this.uploadAvatar(); })
            Text(this.label('交流偏好', 'Conversation preferences')).fontSize(13).fontColor(this.colors.secondary).width('100%').margin({ top: 12 })
            this.settingChoice({ heading: this.label('语气', 'Tone'),
              options: [{ value: this.label('直接', 'Direct') }, { value: this.label('自然', 'Natural') }, { value: this.label('温和', 'Gentle') }], selectedIndex: ['reserved', 'balanced', 'gentle'].indexOf(this.warmth),
              controlId: 'personal-setting-warmth', available: true,
              onSelect: (index: number): void => { this.warmth = ['reserved', 'balanced', 'gentle'][index]; } })
            this.settingChoice({ heading: this.label('棘手时', 'When things get tricky'),
              options: [{ value: this.label('先听', 'Listen') }, { value: this.label('理清', 'Untangle') }, { value: this.label('给办法', 'Suggest') }], selectedIndex: ['listen', 'untangle', 'solutions'].indexOf(this.supportMode),
              controlId: 'personal-setting-support', available: true,
              onSelect: (index: number): void => { this.supportMode = ['listen', 'untangle', 'solutions'][index]; } })
            this.settingChoice({ heading: this.label('回答长度', 'Length'),
              options: [{ value: this.label('简短', 'Brief') }, { value: this.label('适中', 'Balanced') }, { value: this.label('详细', 'Detailed') }], selectedIndex: ['brief', 'balanced', 'detailed'].indexOf(this.detailLevel),
              controlId: 'personal-setting-detail', available: true,
              onSelect: (index: number): void => { this.detailLevel = ['brief', 'balanced', 'detailed'][index]; } })
            this.settingChoice({ heading: this.label('主动更新', 'Updates'),
              options: [{ value: this.label('结果与决定', 'Results only') }, { value: this.label('重要进展', 'Milestones') }, { value: this.label('多提建议', 'Suggestions') }], selectedIndex: ['decisions', 'important', 'open'].indexOf(this.proactivity),
              controlId: 'personal-setting-proactivity', available: true,
              onSelect: (index: number): void => { this.proactivity = ['decisions', 'important', 'open'][index]; } })
            this.settingChoice({ heading: this.label('轻松程度', 'Humor'),
              options: [{ value: this.label('不加玩笑', 'None') }, { value: this.label('偶尔轻松', 'Sometimes') }, { value: this.label('活泼', 'Playful') }], selectedIndex: ['none', 'occasional', 'playful'].indexOf(this.humor),
              controlId: 'personal-setting-humor', available: true,
              onSelect: (index: number): void => { this.humor = ['none', 'occasional', 'playful'][index]; } })
            this.settingChoice({ heading: this.label('通话声音', 'Call voice'), options: this.voiceOptions(),
              selectedIndex: this.availableVoices().findIndex((voice: XopcPersonalVoiceOption): boolean => voice.id === this.voiceId) + 1,
              controlId: 'personal-setting-voice', available: !!this.model.voiceRoute,
              onSelect: (index: number): void => { this.voiceId = index === 0 ? '' : this.availableVoices()[index - 1]?.id ?? ''; } })
            if (this.model.voiceError) { Text(this.model.voiceError).fontColor(this.colors.danger) }
            Text(this.label('会话', 'Conversation')).fontSize(13).fontColor(this.colors.secondary).width('100%').margin({ top: 12 })
            Button(this.label('对话模型', 'Conversation model')).width('100%').height(44)
              .backgroundColor(this.colors.input).fontColor(this.colors.foreground).onClick((): void => { this.onModel(); })
            Button(this.label('思考强度', 'Thinking effort')).width('100%').height(44)
              .backgroundColor(this.colors.input).fontColor(this.colors.foreground).onClick((): void => { this.onThinking(); })
            Button(this.label('会话选项', 'Conversation options')).width('100%').height(44)
              .backgroundColor(this.colors.input).fontColor(this.colors.foreground).onClick((): void => { this.onActions(); })
            Text(this.label('主动联系', 'Proactive messages')).fontColor(this.colors.foreground).width('100%')
            if (this.model.outreach) {
              this.settingChoice({ heading: this.label('联系频率', 'Participation'),
                options: [{ value: this.label('关闭', 'Off') }, { value: this.label('仅明确跟进', 'Requested follow-ups') },
                  { value: this.label('适度主动', 'Thoughtful participation') }],
                selectedIndex: ['off', 'follow_up', 'balanced'].indexOf(this.outreachMode),
                controlId: 'personal-setting-outreach', available: true,
                onSelect: (index: number): void => { this.outreachMode = ['off', 'follow_up', 'balanced'][index]; this.outreachSaved = false; } })
              Text(this.label('时区', 'Timezone')).fontSize(13).fontColor(this.colors.secondary).width('100%')
              TextInput({ text: this.timezone, placeholder: this.label('IANA 时区，例如 Asia/Shanghai', 'IANA timezone, e.g. Asia/Shanghai') })
                .id('personal-setting-timezone').width('100%').height(44).fontColor(this.colors.foreground).backgroundColor(this.colors.input)
                .onChange((text: string): void => { this.timezone = text; this.outreachSaved = false; })
              Text(this.label('静默开始 / 结束', 'Quiet from / until')).fontColor(this.colors.secondary)
              Row({ space: 12 }) {
                Select([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map((hour: number): SelectOption => { return { value: hour.toString().padStart(2, '0') + ':00' }; }))
                  .selected(this.quietStart).value(this.quietStart.toString().padStart(2, '0') + ':00')
                  .id('personal-setting-quiet-start').layoutWeight(1).height(44).fontColor(this.colors.foreground).onSelect((hour: number): void => { this.quietStart = hour; this.outreachSaved = false; })
                Select([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map((hour: number): SelectOption => { return { value: hour.toString().padStart(2, '0') + ':00' }; }))
                  .selected(this.quietEnd).value(this.quietEnd.toString().padStart(2, '0') + ':00')
                  .id('personal-setting-quiet-end').layoutWeight(1).height(44).fontColor(this.colors.foreground).onSelect((hour: number): void => { this.quietEnd = hour; this.outreachSaved = false; })
              }.width('100%')
              Button(this.outreachSaved ? this.label('已保存', 'Saved') : this.label('保存主动联系设置', 'Save proactive settings')).width('100%').height(44)
                .backgroundColor(this.colors.accentSoft).fontColor(this.colors.accent)
                .enabled(!this.model.saving && !!this.timezone.trim()).onClick(async (): Promise<void> => {
                  this.outreachSaved = await this.model.saveOutreach(this.outreachMode, this.timezone, this.quietStart, this.quietEnd);
                })
            }
            if (this.model.outreachError) { Text(this.model.outreachError).fontColor(this.colors.danger) }
            if (this.model.error) { Text(this.model.error).fontColor(this.colors.danger) }
            Button(this.label('重新加载设置', 'Reload settings')).width('100%').height(44)
              .backgroundColor(this.colors.input).fontColor(this.colors.foreground).onClick((): void => { void this.reload(); })
          }.width('100%').padding(20).enabled(!this.model.saving && !this.uploading)
        }.id('personal-settings-scroll').layoutWeight(1).width('100%').scrollBar(BarState.Auto)
      }
      Button(this.model.saving ? this.label('正在保存…', 'Saving…') : this.label('保存资料', 'Save profile'))
        .id('personal-agent-profile-save').width('90%').height(44).margin({ top: 12, bottom: 28 })
        .backgroundColor(this.colors.accent).fontColor(Color.White)
        .enabled(!this.model.loading && !this.model.saving && !this.uploading && !!this.assistantName.trim())
        .onClick((): void => { void this.save(); })
    }.id('personal-agent-profile-sheet').width('100%').height('100%').backgroundColor(this.colors.panel)
  }
}
