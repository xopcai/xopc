import { common } from '@kit.AbilityKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { appSettings } from '../service/settings';
import { gatewaySession } from '../service/gatewaySession';
import { pickChatPhoto } from '../service/chatPhotoPicker';
import { XopcPersonalAgentRecord, XopcPersonalPreferences, XopcPersonalVoiceOption } from '../model/personalAgent';
import { XopcPersonalAgentSettingsViewModel } from '../viewmodel/personalAgentSettingsViewModel';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';
import { XopcListSkeleton } from './MobileComponents';

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

  build() {
    Column() {
      Row() {
        Text(this.label('配置 Personal AI', 'Personal AI settings')).fontSize(20).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.foreground).layoutWeight(1)
        Button('×').width(44).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
          .onClick((): void => { this.onClose(); })
      }.width('100%').padding({ left: 20, right: 16, top: 12 })
      if (this.model.loading) { XopcListSkeleton() }
      else {
        Scroll() {
          Column({ space: 16 }) {
            if (this.avatarPreview && this.appearance === 'custom') {
              Image(this.avatarPreview).width(72).height(72).borderRadius(36).objectFit(ImageFit.Cover)
            } else {
              XopcPersonalAgentAvatar({ agentId: this.record?.agentId ?? '', appearance: this.appearance, extent: 72, revision: this.model.record?.revision ?? 0 })
            }
            TextInput({ text: this.assistantName, placeholder: this.label('助手名称', 'Assistant name') }).maxLength(60)
              .onChange((text: string): void => { this.assistantName = text; })
            TextInput({ text: this.addressAs, placeholder: this.label('怎么称呼你', 'How to address you') }).maxLength(60)
              .onChange((text: string): void => { this.addressAs = text; })
            Text(this.label('形象', 'Appearance')).fontColor(this.colors.foreground).width('100%')
            Select([{ value: 'Loopi' }, { value: this.label('好奇', 'Curious') }, { value: this.label('温和', 'Gentle') },
              { value: this.label('自定义', 'Custom') }]).selected(['loopi', 'loopi-curious', 'loopi-care', 'custom'].indexOf(this.appearance))
              .onSelect((index: number): void => { if (index < 3 || this.record?.appearance === 'custom') this.appearance = ['loopi', 'loopi-curious', 'loopi-care', 'custom'][index]; })
            Button(this.label('上传头像', 'Upload avatar')).enabled(!this.uploading).onClick((): void => { void this.uploadAvatar(); })
            Text(this.label('语气', 'Tone')).fontColor(this.colors.foreground).width('100%')
            Select([{ value: this.label('直接', 'Direct') }, { value: this.label('自然', 'Natural') }, { value: this.label('温和', 'Gentle') }]).selected(['reserved', 'balanced', 'gentle'].indexOf(this.warmth))
              .onSelect((index: number): void => { this.warmth = ['reserved', 'balanced', 'gentle'][index]; })
            Text(this.label('棘手时', 'When things get tricky')).fontColor(this.colors.foreground).width('100%')
            Select([{ value: this.label('先听', 'Listen') }, { value: this.label('理清', 'Untangle') }, { value: this.label('给办法', 'Suggest') }]).selected(['listen', 'untangle', 'solutions'].indexOf(this.supportMode))
              .onSelect((index: number): void => { this.supportMode = ['listen', 'untangle', 'solutions'][index]; })
            Text(this.label('回答长度', 'Length')).fontColor(this.colors.foreground).width('100%')
            Select([{ value: this.label('简短', 'Brief') }, { value: this.label('适中', 'Balanced') }, { value: this.label('详细', 'Detailed') }]).selected(['brief', 'balanced', 'detailed'].indexOf(this.detailLevel))
              .onSelect((index: number): void => { this.detailLevel = ['brief', 'balanced', 'detailed'][index]; })
            Text(this.label('主动更新', 'Updates')).fontColor(this.colors.foreground).width('100%')
            Select([{ value: this.label('结果与决定', 'Results only') }, { value: this.label('重要进展', 'Milestones') }, { value: this.label('多提建议', 'Suggestions') }]).selected(['decisions', 'important', 'open'].indexOf(this.proactivity))
              .onSelect((index: number): void => { this.proactivity = ['decisions', 'important', 'open'][index]; })
            Text(this.label('轻松程度', 'Humor')).fontColor(this.colors.foreground).width('100%')
            Select([{ value: this.label('不加玩笑', 'None') }, { value: this.label('偶尔轻松', 'Sometimes') }, { value: this.label('活泼', 'Playful') }]).selected(['none', 'occasional', 'playful'].indexOf(this.humor))
              .onSelect((index: number): void => { this.humor = ['none', 'occasional', 'playful'][index]; })
            Text(this.label('通话声音', 'Call voice')).fontColor(this.colors.foreground).width('100%')
            Select(this.voiceOptions())
              .selected(this.availableVoices().findIndex((voice: XopcPersonalVoiceOption): boolean => voice.id === this.voiceId) + 1)
              .onSelect((index: number): void => { this.voiceId = index === 0 ? '' : this.availableVoices()[index - 1].id; })
              .enabled(!!this.model.voiceRoute)
            if (this.model.voiceError) { Text(this.model.voiceError).fontColor(this.colors.danger) }
            Button(this.label('对话模型', 'Conversation model')).onClick((): void => { this.onModel(); })
            Button(this.label('思考强度', 'Thinking effort')).onClick((): void => { this.onThinking(); })
            Button(this.label('会话选项', 'Conversation options')).onClick((): void => { this.onActions(); })
            Text(this.label('主动联系', 'Proactive messages')).fontColor(this.colors.foreground).width('100%')
            if (this.model.outreach) {
              Select([{ value: this.label('关闭', 'Off') }, { value: this.label('仅明确跟进', 'Requested follow-ups') },
                { value: this.label('适度主动', 'Thoughtful participation') }]).selected(['off', 'follow_up', 'balanced'].indexOf(this.outreachMode))
                .onSelect((index: number): void => { this.outreachMode = ['off', 'follow_up', 'balanced'][index]; this.outreachSaved = false; })
              TextInput({ text: this.timezone, placeholder: this.label('IANA 时区，例如 Asia/Shanghai', 'IANA timezone, e.g. Asia/Shanghai') })
                .onChange((text: string): void => { this.timezone = text; this.outreachSaved = false; })
              Text(this.label('静默开始 / 结束', 'Quiet from / until')).fontColor(this.colors.secondary)
              Row({ space: 12 }) {
                Select([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map((hour: number): SelectOption => { return { value: hour.toString().padStart(2, '0') + ':00' }; }))
                  .selected(this.quietStart).onSelect((hour: number): void => { this.quietStart = hour; this.outreachSaved = false; })
                Select([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map((hour: number): SelectOption => { return { value: hour.toString().padStart(2, '0') + ':00' }; }))
                  .selected(this.quietEnd).onSelect((hour: number): void => { this.quietEnd = hour; this.outreachSaved = false; })
              }
              Button(this.outreachSaved ? this.label('已保存', 'Saved') : this.label('保存主动联系设置', 'Save proactive settings'))
                .enabled(!this.model.saving && !!this.timezone.trim()).onClick(async (): Promise<void> => {
                  this.outreachSaved = await this.model.saveOutreach(this.outreachMode, this.timezone, this.quietStart, this.quietEnd);
                })
            }
            if (this.model.outreachError) { Text(this.model.outreachError).fontColor(this.colors.danger) }
            if (this.model.error) { Text(this.model.error).fontColor(this.colors.danger) }
            Button(this.label('重新加载设置', 'Reload settings')).onClick((): void => { void this.reload(); })
          }.width('100%').padding(20).enabled(!this.model.saving && !this.uploading)
        }.layoutWeight(1).width('100%')
      }
      Button(this.model.saving ? this.label('正在保存…', 'Saving…') : this.label('保存资料', 'Save profile'))
        .id('personal-agent-profile-save').width('90%').height(44).margin({ top: 8, bottom: 20 })
        .enabled(!this.model.loading && !this.model.saving && !this.uploading && !!this.assistantName.trim())
        .onClick((): void => { void this.save(); })
    }.id('personal-agent-profile-sheet').width('100%').height('100%').backgroundColor(this.colors.panel)
  }
}
