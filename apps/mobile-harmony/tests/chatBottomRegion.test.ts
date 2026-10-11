import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chat = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');
const options = readFileSync(new URL('../entry/src/main/ets/view/ChatOptions.ets', import.meta.url), 'utf8');
const home = readFileSync(new URL('../entry/src/main/ets/view/HomeView.ets', import.meta.url), 'utf8');
const sessions = readFileSync(new URL('../entry/src/main/ets/view/SessionsView.ets', import.meta.url), 'utf8');
const notesTab = readFileSync(new URL('../entry/src/main/ets/view/NotesTabView.ets', import.meta.url), 'utf8');
const homeHubs = readFileSync(new URL('../entry/src/main/ets/view/HomeHubs.ets', import.meta.url), 'utf8');
const personal = readFileSync(new URL('../entry/src/main/ets/view/PersonalView.ets', import.meta.url), 'utf8');
const english = readFileSync(new URL('../entry/src/main/resources/base/element/string.json', import.meta.url), 'utf8');
const chinese = readFileSync(new URL('../entry/src/main/resources/zh_CN/element/string.json', import.meta.url), 'utf8');
const mobileComponents = readFileSync(new URL('../entry/src/main/ets/view/MobileComponents.ets', import.meta.url), 'utf8');
const actionPanel = readFileSync(new URL('../entry/src/main/ets/view/ChatActionPanel.ets', import.meta.url), 'utf8');

describe('chat bottom region composition', () => {
  it('animates session refresh only for an explicit pull gesture', () => {
    expect(sessions).toContain('Refresh({ refreshing: this.sessions.refreshing })');
    expect(sessions).not.toContain('refreshing: this.sessions.loading');
    expect(sessions).toContain('.onRefreshing((): void => { this.sessions.load(false, true); })');
    const activation = sessions.slice(sessions.indexOf('  private activate()'), sessions.indexOf('  @Computed'));
    expect(activation).toContain('this.sessions.load();');
    expect(activation).not.toContain('load(false, true)');
  });
  it('floats a light neutral jump button over a transparent message viewport', () => {
    expect(chat).toContain('Stack({ alignContent: Alignment.Bottom })');
    expect(chat).toContain(".id('chat-message-list').height('100%')");
    expect(chat).toContain(".id('chat-message-viewport').layoutWeight(1).width('100%').backgroundColor(Color.Transparent)");
    const jump = chat.slice(chat.indexOf(".id('chat-jump-bottom')"), chat.indexOf(".id('chat-message-viewport')"));
    expect(jump).toContain('.backgroundColor(this.colors.grouped)');
    expect(chat).toContain("Text('↓').fontSize(20).fontColor(this.colors.secondary)");
    expect(jump).toContain('.height(36).width(36)');
    expect(jump).toContain('.responseRegion({ x: -4, y: -4, width: 44, height: 44 })');
    expect(jump).toContain('this.messagesScroller.scrollEdge(Edge.Bottom)');
  });

  it('shows the jump button only while scrolling back toward the latest message', () => {
    expect(chat).toContain('@Local showJumpBottom: boolean = false;');
    expect(chat).toContain('if (this.atBottom) { this.showJumpBottom = false; this.updateReplySpace(); }');
    expect(chat).toContain('else if (offset > 0) this.showJumpBottom = true;');
    expect(chat).toContain('else if (offset < 0) this.showJumpBottom = false;');
    expect(chat).toContain('if (!this.atBottom && this.showJumpBottom)');
    expect(chat).toContain('this.atBottom = true; this.showJumpBottom = false; this.updateReplySpace();');
  });

  it('replaces the jump arrow with the shared animated mascot while AI is responding', () => {
    expect(chat).toContain('if (this.chat.runId)');
    expect(chat).toContain('XopcBrandLoading({ compact: true, reduceMotion: this.layout.reduceMotion })');
    expect(mobileComponents).toContain('XopcLoopi({ extent: this.compact ? 20 : 42');
    expect(mobileComponents).toContain('activePage: !this.reduceMotion');
  });
  it('renders the navigation slot after the composer inside the shared surface', () => {
    const composer = chat.indexOf(".id('chat-composer-shell')");
    const slot = chat.indexOf('this.bottomDock()', composer);
    const surface = chat.indexOf(".id('chat-bottom-region')", slot);
    expect(composer).toBeGreaterThan(0);
    expect(slot).toBeGreaterThan(composer);
    expect(surface).toBeGreaterThan(slot);
    expect(chat.match(/TextArea\(\{ text: this.draft/g)).toHaveLength(1);
  });

  it('masks content at the lower dock corners while keeping the floating surface transparent', () => {
    expect(chat).toContain('@Local bottomRegionHeight: number = 0;');
    expect(chat).toContain('Stack({ alignContent: Alignment.Bottom })');
    expect(chat).toContain('.contentEndOffset(this.bottomRegionHeight + 24 + this.replySpaceHeight)');
    expect(chat).toContain('this.bottomRegionHeight = Number(current.height);');
    expect(chat).toContain("}.id('chat-content-viewport').width('100%').height('100%')");
    expect(chat).not.toContain('.padding({ bottom: this.bottomRegionHeight }).clip(true)');
    expect(chat).toContain('.margin({ bottom: this.bottomRegionHeight + 8 })');
    expect(chat).toContain("}.width('100%').layoutWeight(1)\n  }");
    expect(home).toContain('Stack({ alignContent: Alignment.Bottom })');
    expect(home).toContain('@Local secondaryBottomRegionHeight: number = 0;');
    expect(home).toContain("}.id('home-tab-viewport').width('100%').height('100%')");
    expect(home).not.toContain('.padding({ bottom: this.tab === 0 || this.tab === 3 ? 0 : this.secondaryBottomRegionHeight }).clip(true)');
    expect(home).toContain('this.secondaryBottomRegionHeight = Number(current.height);');
    expect(home).toContain("}.id('secondary-bottom-region').width('100%')");
    expect(home).toContain("Column().id('secondary-dock-corner-mask').width('100%').height(24).backgroundColor(this.colors.surface)");
    expect(home).not.toContain("}.id('secondary-bottom-region').width('100%').backgroundColor");
    expect(home).toContain(".width('100%').height('100%')");
  });

  it('keeps one consistent rounded navigation surface across every tab', () => {
    expect(home).toContain('bottomDock: this.chatDock');
    expect(home).toContain('@LocalBuilder\n  chatDock()');
    expect(home).toContain('this.tab === 0 && this.layout.isMainDockVisible(0)');
    expect(home).toContain('if (this.tab !== 0)');
    expect(home.match(/this.tabItem\(/g)).toHaveLength(5);
    expect(home).toContain('.onClick((): void => { this.selectTab(index); })');
    expect(home).toContain("this.tabItem(0, this.personalAgent.record?.state === 'ready'");
    expect(home).toContain('&& this.personalAgent.record.conversationId === this.activeChatId');
    expect(home).toContain("? this.personalAgent.record.displayName : $r('app.string.assistant')");
    expect(home).not.toContain("$r('sys.symbol.star')");
    expect(home).toContain('this.attention.needsUser.length');
    expect(chat).toContain(".id('chat-bottom-region').width('100%')");
    expect(chat).toContain("Column().id('chat-dock-corner-mask').width('100%').height(24).backgroundColor(this.colors.surface)");
    expect(chat).not.toContain("}.id('chat-bottom-region').width('100%').backgroundColor");
    expect(home).toContain(".id('secondary-bottom-region').width('100%')");
    expect(home).not.toContain("}.id('secondary-bottom-region').width('100%').backgroundColor");
    expect(chat).toContain(".id('chat-bottom-surface').width('calc(100% - 16vp)').backgroundColor(this.colors.panel)");
    expect(chat).not.toContain('.backgroundBlurStyle(BlurStyle.COMPONENT_REGULAR)');
    expect(chat).toContain('.borderRadius(24).clip(true)');
    expect(home).toContain(".id('main-tab-dock').width('100%')");
    expect(home).not.toContain("}.id('main-tab-dock').width('100%').backgroundColor");
    expect(home).toContain(".id('secondary-bottom-surface').width('calc(100% - 16vp)').backgroundColor(this.colors.panel)");
    expect(home).toContain('.borderRadius(24).clip(true)');
    expect(home).not.toContain('.backgroundBlurStyle(BlurStyle.COMPONENT_REGULAR)');
    expect(chat).toContain(".id('chat-composer-shell').width('calc(100% - 16vp)').backgroundColor(this.colors.input)");
    expect(home).toContain(".id('home-quick-composer-shell').width('calc(100% - 16vp)').backgroundColor(this.colors.input)");
    expect(home).toContain('.borderRadius(18).clip(true).margin({ top: 8, bottom: 8 })');
    expect(home).not.toContain(".id('secondary-tab-dock')");
  });

  it('offers a stable quick composer on non-chat tabs and routes its message into chat', () => {
    expect(home).toContain(".id('home-quick-composer')");
    expect(home).toContain(".id('home-quick-send')");
    expect(home).toContain(".id('home-quick-voice').width(COMPOSER_TOOL_SIZE).height(COMPOSER_TOOL_SIZE)");
    expect(home).toContain(".id('home-quick-actions').width(COMPOSER_TOOL_SIZE).height(COMPOSER_TOOL_SIZE)");
    expect(home).toContain("XopcChatActionPanel({ open: this.quickPanelOpen, idPrefix: 'home-quick-action'");
    expect(chat).toContain('XopcChatActionPanel({ open: this.panelOpen');
    expect(actionPanel).toContain("this.actionTile('photos', $r('app.string.chat_photos')");
    expect(actionPanel).toContain("this.actionTile('reference-note', $r('app.string.chat_reference_note')");
    expect(actionPanel).toContain("this.actionTile('voice-with-tools', $r('app.string.voice_call_action_assistant')");
    expect(home).toContain("SymbolGlyph(this.quickPanelOpen ? $r('sys.symbol.xmark_circle') : $r('sys.symbol.plus_circle'))");
    expect(home).not.toContain('showQuickAttachments');
    expect(home).not.toContain("showActionSheet({ title: '', message: '', sheets:");
    expect(home).toContain(".id('home-quick-composer').layoutWeight(1).height(COMPOSER_INPUT_MIN)");
    expect(home).toContain('private async sendQuickDraft(): Promise<void>');
    expect(home).toContain('if ((!prompt && !this.quickFiles.length) || this.quickSending || this.quickPicking) return;');
    expect(home).toContain('this.quickSending = true;');
    expect(home).toContain('finally { this.quickSending = false; }');
    expect(home).toContain('quickChatIntake.enqueue(id, prompt, this.quickFiles);');
    expect(home).toContain("this.switchToChat(id, '');");
    expect(home.indexOf(".id('home-quick-actions')")).toBeLessThan(home.indexOf(".id('home-quick-send')"));
    expect(home).toContain('requestedAction: this.requestedChatAction, actionRevision: this.chatActionRevision');
    expect(chat).toContain("@Monitor('actionRevision', 'chat.selectedId', 'chat.loading', 'restoringDraft', 'activePage')");
    expect(chat).toContain('this.setPanel(true);');
    expect(chat).toContain('this.chooseAction(this.requestedAction);');
    expect(home).toContain('private activateTab(index: number): void');
    expect(home).toContain('.animationDuration(0)');
    expect(home).not.toContain('transitionToTab');
    expect(home.slice(home.indexOf('private activateTab('), home.indexOf('private switchToChat('))).not.toContain('this.getUIContext().animateTo');
    expect(home).toContain('if (this.layout.isMainDockVisible(this.tab)) { this.dockItems() }');
    expect(home).toContain(".margin({ top: 4, bottom: 0 })");
  });

  it('adapts the quick composer placeholder to the active tab', () => {
    expect(home).toContain('@Computed get quickComposerPlaceholder(): ResourceStr');
    expect(home).toContain("this.tab === 2 ? $r('app.string.quick_chat_progress_placeholder')");
    expect(home).toContain("this.tab === 3 ? $r('app.string.quick_chat_library_placeholder')");
    expect(home).toContain("this.tab === 4 ? $r('app.string.quick_chat_personal_placeholder')");
    expect(home).toContain("$r('app.string.quick_chat_conversations_placeholder')");
    expect(home).toContain('placeholder: this.quickComposerPlaceholder');
    expect(home).not.toContain("$r('app.string.quick_chat_placeholder')");
    for (const resourceName of ['quick_chat_conversations_placeholder', 'quick_chat_progress_placeholder',
      'quick_chat_library_placeholder', 'quick_chat_personal_placeholder']) {
      expect(english).toContain(`\"name\": \"${resourceName}\"`);
      expect(chinese).toContain(`\"name\": \"${resourceName}\"`);
    }
  });

  it('opens creation in an editable AI sheet before offering the full chat', () => {
    expect(home).toContain('this.creationSheetOpen = true;');
    expect(home).toContain('.bindSheet($$this.creationSheetOpen, this.creationChatSheet');
    expect(home).toContain('height: SheetSize.LARGE, dragBar: true, showClose: false');
    expect(home).toContain('keyboardAvoidMode: SheetKeyboardAvoidMode.RESIZE_ONLY');
    expect(home).toContain('onDisappear: (): void => { this.completeCreationHandoff(); }');
    expect(home).toContain("Button($r('app.string.continue_in_chat'))");
    expect(home).toContain(".id('creation-chat-close')");
    expect(home).toContain('activePage: this.creationSheetOpen, embedded: true');
    expect(home).toContain("}.layoutWeight(1).width('100%')");
    expect(home).toContain('this.continueCreationChat();');
    expect(home).toContain("this.switchToChat(this.creationChatId, '', true);");
  });

  it('keeps the bottom surface flush with the app safe-area edge', () => {
    expect(chat).toContain(".margin({ top: 4, bottom: 0 })");
    expect(chat).not.toContain('bottom: this.layout.keyboardVisible ? 0 : 8');
    expect(home).not.toContain('bottom: this.layout.keyboardVisible ? 0 : 8');
  });

  it('keeps the phone library content transparent over the shared page surface', () => {
    expect(home).toContain('bottomInset: this.secondaryBottomRegionHeight');
    expect(notesTab).toContain('@Param bottomInset: number = 0;');
    expect(notesTab).toContain("}.id('notes-tab-content-viewport').width('100%').height('100%')");
    expect(notesTab).not.toContain('.padding({ bottom: this.bottomInset }).clip(true)');
    expect(notesTab).toContain('.contentEndOffset(this.bottomInset)');
    expect(notesTab).toContain("}.id('notes-tab-list-pane').width(this.contentWidth >= 840 ? 400 : '100%').height('100%')");
    expect(notesTab).toContain('.backgroundColor(this.contentWidth >= 840 ? this.colors.grouped : Color.Transparent)');
    expect(notesTab).toContain("}.id('notes-tab-root').width('100%').height('100%').backgroundColor(this.colors.surface)");
    expect(notesTab).not.toContain('this.contentWidth >= 840 ? this.colors.grouped : this.colors.surface');
  });

  it('does not stack page-level bottom padding on top of the reserved composer inset', () => {
    expect(notesTab).toContain(".padding({ left: 20, right: 20 }).scrollBar(BarState.Off)");
    expect(notesTab).not.toContain("padding({ left: 20, right: 20, bottom: 24 })");
    expect(sessions).not.toContain("padding({ left: 20, right: 20, bottom: 20 }).cachedCount(5)");
    expect(homeHubs).not.toContain("padding({ left: 20, right: 20, bottom: 28 })");
    expect(personal).not.toContain("padding({ left: 20, right: 20, bottom: 28 })");
  });

  it('uses a dedicated conversation tab and leaves the system back edge unobstructed', () => {
    expect(home).toContain('XopcSessionsView({ embedded: true');
    expect(home).toContain('this.openConversationFromList(id, false)');
    expect(home).toContain('this.openConversationFromList(id, true)');
    expect(home).toContain('this.activateTab(1);');
    expect(sessions).toContain('.virtualScroll({ totalCount: this.rows.length })');
    expect(sessions).toContain('.cachedCount(5)');
    expect(chat).not.toContain('chat-drawer');
    expect(chat).not.toContain('PanGesture({ direction: PanDirection.Horizontal');
  });

  it('centers the conversation create icon without relying on a clipped text glyph', () => {
    const createButton = sessions.slice(sessions.indexOf("SymbolGlyph($r('sys.symbol.plus'))"),
      sessions.indexOf(".id('sessions-new')") + 96);
    expect(createButton).toContain("SymbolGlyph($r('sys.symbol.plus')).fontSize(22)");
    expect(createButton).toContain(".id('sessions-new').width(44).height(44).padding(0)");
    expect(sessions).not.toContain("Button('+').id('sessions-new')");
  });

  it('keeps routine Gateway connection progress quiet and renders capsule search and settings actions', () => {
    expect(chat).toContain('if (this.hasConnectionIssue())');
    expect(chat).not.toContain("if (this.chat.connection !== 'connected')");
    expect(chat).toContain("this.chat.connection === 'gateway_update_required' || this.chat.connection.startsWith('error:')");
    const header = chat.slice(chat.indexOf('if (!this.embedded)'), chat.indexOf('if (this.sendFlightActive)'));
    expect(header).toContain("$r('sys.symbol.gearshape')");
    expect(header).toContain("$r('sys.symbol.magnifyingglass')");
    expect(header).toContain(".id('chat-header-actions')");
    expect(header).toContain(".id('chat-header-search')");
    expect(header).toContain('this.personalSettingsOpen = true');

  });

  it('shows the conversation title in the header and keeps model selection in the actions sheet', () => {
    const header = chat.slice(chat.indexOf('if (!this.embedded)'), chat.indexOf('if (this.sendFlightActive)'));
    expect(header).toContain("this.personalConversation ? this.personalAgent?.displayName ?? 'Ada' : this.chat.title || $r('app.string.untitled')");
    expect(header).not.toContain("$r('sys.symbol.line_3_horizontal')");
    expect(header).not.toContain("this.options.modelName(appSettings.effectiveLanguage())");
    expect(header).not.toContain(".id('chat-model-picker')");
    expect(header).not.toContain("this.openSheet('model')");
    expect(options).toContain("heading: $r('app.string.chat_model')");
    expect(options).toContain("onOpen: (): void => { this.onMode('model'); }");
  });

  it('sizes chat sheets from their active mode and content instead of a fixed viewport percentage', () => {
    expect(chat).toContain('@Computed get sheetHeight(): number');
    expect(chat).toContain("if (this.sheetMode === 'project')");
    expect(chat).toContain("if (this.sheetMode === 'environment')");
    expect(chat).toContain("if (this.sheetMode === 'context')");
    expect(chat).toContain("if (this.sheetMode === 'directory')");
    expect(chat).toContain('height: this.sheetHeight');
    expect(chat).toContain('.bindSheet($$this.sheetOpen, this.optionsSheet, { height: this.sheetHeight');
    expect(chat).toContain('onMode: (mode: string): void => { this.sheetMode = mode; }');
  });

  it('uses a hold-and-slide voice gesture instead of click-to-start recording', () => {
    expect(chat).toContain("@Local voiceDestination: XopcVoiceRecordingDestination = 'send'");
    expect(chat).toContain('.onTouch((event: TouchEvent): void => { this.handleVoiceTouch(event); })');
    expect(chat).toContain("this.voiceRetryDestination === 'text'");
    expect(chat).toContain("destination === 'cancel'");
    expect(chat).toContain('await this.sendVoice(false)');
    expect(chat).not.toContain(".onClick(async (): Promise<void> => { await this.reader.stop(); if (this.visible) this.voice.start");
  });

  it('keeps voice recording compact and shows only a retry path after failure', () => {
    expect(chat).not.toContain("$r('app.string.play_recording')");
    expect(chat).not.toContain(".id('chat-voice-send')");
    expect(chat).not.toContain(".id('chat-voice-finish')");
    expect(chat).toContain(".id('chat-voice-retry')");
    expect(chat).toContain("if (this.voiceHeld) { this.voiceGestureFeedback() }");
    expect(chat).toContain('.margin({ bottom: this.bottomRegionHeight + 16 })');
    expect(chat).toContain('.hitTestBehavior(HitTestMode.None)');
    expect(chat).toContain('point.id === this.voicePointerId');
    expect(chat).toContain('generation !== this.voiceHoldGeneration');
  });

  it('uses a compact icon capsule without duplicate recording instructions', () => {
    const feedback = chat.slice(chat.indexOf('  voiceGestureFeedback() {'), chat.indexOf('  emptyDock() {}'));
    expect(feedback).toContain(".constraintSize({ maxWidth: 340 }).height(80)");
    expect(feedback).toContain("$r('sys.symbol.xmark')");
    expect(feedback).toContain("$r('sys.symbol.text_alignleft')");
    expect(feedback).toContain('.accessibilityText(');
    expect(feedback).not.toContain('Text(this.voiceHoldHint())');
    expect(feedback).not.toMatch(/\n\s+Text\(\$r\('app\.string\.voice_slide_/);
    expect(feedback).not.toContain("Text('↖')");
    expect(feedback).toContain('.backgroundColor(this.colors.panel)');
    expect(feedback).not.toContain('.border(');
    expect(feedback).toContain('.fontColor(this.colors.secondary)');
    expect(feedback).toContain('.fontColor([this.colors.accent])');
    expect(feedback).toContain("this.voiceDestination === 'text' ? this.colors.accentSoft : Color.Transparent");
    expect(feedback).not.toContain('.backgroundColor(this.colors.foreground)');
    expect(feedback).not.toContain('.fontColor([this.colors.panel])');
  });

  it('moves persistent project and environment controls out of the composer into the header menu', () => {
    expect(chat).not.toContain('composerScope()');
    expect(chat).not.toContain(".id('chat-composer-scope')");
    expect(chat).toContain('contextSummary: this.contextMenuSummary()');
    expect(chat).toContain("onContext: (): void => { this.sheetMode = 'context'; }");
    expect(options).toContain("heading: $r('app.string.chat_context'), summary: this.contextSummary");
  });

  it('uses one cohesive read-aloud player instead of adjacent pause and stop labels', () => {
    const player = chat.slice(chat.indexOf(".id('chat-read-aloud-toggle')") - 1700,
      chat.indexOf(".id('chat-read-aloud-player')") + 260);
    expect(player).toContain(".id('chat-read-aloud-toggle')");
    expect(player).toContain("$r('sys.symbol.play_fill')");
    expect(player).toContain("$r('sys.symbol.pause_fill')");
    expect(player).toContain(".id('chat-read-aloud-stop')");
    expect(player).toContain("$r('sys.symbol.xmark')");
    expect(player).toContain("$r('app.string.chat_read_aloud_pause_hint')");
    expect(player).toContain("$r('app.string.chat_read_aloud_resume_hint')");
    expect(player).not.toContain("Button(this.reader.state === 'paused' ? $r('app.string.resume') : $r('app.string.pause'))");
    expect(player).not.toContain("Button($r('app.string.stop'))");
  });

  it('keeps Gateway connection management out of the conversation tab header', () => {
    expect(sessions).not.toContain(".id('drawer-gateways')");
    expect(sessions).not.toContain('connectionModel.openGateways()');
    expect(sessions).not.toContain('gatewaySession.currentProfile()');
  });

  it('uses a compact horizontally swipeable action grid with common actions on the first page', () => {
    const panel = actionPanel;
    const secondPage = panel.indexOf("this.actionTile('voice-no-tools'");

    expect(panel).toContain('Swiper()');
    expect(panel).toContain(".id(this.idPrefix + '-panel').width('100%').height(196).loop(false).autoPlay(false)");
    expect(panel).toContain('new DotIndicator()');
    expect(panel).not.toContain('Scroll()');
    expect(panel).toContain(".width('25%').height(84).padding(2)");
    expect(panel).toContain('}.width(48).height(48)');
    for (const id of ['photos', 'camera', 'document', 'record-voice', 'reference-note', 'reference-task', 'reference-file', 'new-chat']) {
      expect(panel.indexOf(`this.actionTile('${id}'`)).toBeGreaterThan(0);
      expect(panel.indexOf(`this.actionTile('${id}'`)).toBeLessThan(secondPage);
    }
    expect(secondPage).toBeGreaterThan(0);
    expect(panel.indexOf("this.actionTile('voice-with-tools'")).toBeGreaterThan(secondPage);
  });

  it('keeps voice and rich follow-up capture available while an agent run is active', () => {
    const voiceToggle = chat.slice(chat.indexOf('@Builder\n  voiceToggle()'), chat.indexOf('@Builder\n  composerRightActions()'));
    expect(voiceToggle).not.toContain('!this.chat.runId');
    for (const id of ['photos', 'camera', 'document', 'record-voice']) {
      const action = actionPanel.split('\n').find(line => line.includes(`this.actionTile('${id}'`));
      expect(action).toBeDefined();
      expect(action).not.toContain('!this.chat.runId');
    }
  });
});
