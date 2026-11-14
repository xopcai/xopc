import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chat = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');
const options = readFileSync(new URL('../entry/src/main/ets/view/ChatOptions.ets', import.meta.url), 'utf8');
const home = readFileSync(new URL('../entry/src/main/ets/view/HomeView.ets', import.meta.url), 'utf8');
const sessions = readFileSync(new URL('../entry/src/main/ets/view/SessionsView.ets', import.meta.url), 'utf8');
const notesTab = readFileSync(new URL('../entry/src/main/ets/view/NotesTabView.ets', import.meta.url), 'utf8');
const homeHubs = readFileSync(new URL('../entry/src/main/ets/view/HomeHubs.ets', import.meta.url), 'utf8');
const personal = readFileSync(new URL('../entry/src/main/ets/view/PersonalView.ets', import.meta.url), 'utf8');
const mobileComponents = readFileSync(new URL('../entry/src/main/ets/view/MobileComponents.ets', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../entry/src/main/ets/view/ChatSidebar.ets', import.meta.url), 'utf8');
const actionPanel = readFileSync(new URL('../entry/src/main/ets/view/ChatActionPanel.ets', import.meta.url), 'utf8');

describe('chat bottom region composition', () => {
  it('opens task conversations with the full chat header while retaining task navigation', () => {
    const taskDestination = home.slice(home.indexOf("} else if (page === 'task-conversation')"),
      home.indexOf("} else if (page === 'tasks'"));
    expect(taskDestination).toContain("requestedId: (param as XopcMobileRoute).prompt ?? ''");
    expect(taskDestination).toContain('taskId: (param as XopcMobileRoute).itemId, activePage: true, embedded: false');
    expect(taskDestination).toContain('this.pathStack.pop(); return true;');
    expect(taskDestination).not.toContain('task_open_conversation');
  });
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
    expect(jump).toContain('this.resetMessagePosition(); this.updateReplySpace(); this.onMessageChange();');
  });

  it('gates the jump button on downward scrolling away from the latest message', () => {
    expect(chat).toContain('@Local showJumpBottom: boolean = false;');
    expect(chat).toContain('if (this.atBottom) { this.showJumpBottom = false; this.updateReplySpace(); }');
    expect(chat).toContain('else if (offset !== 0) this.showJumpBottom = offset > 0;');
    expect(chat).toContain('if (!this.atBottom && this.showJumpBottom)');
    expect(chat).toContain('this.resetMessagePosition(); this.updateReplySpace(); this.onMessageChange();');
  });

  it('replaces the jump arrow with the shared animated mascot while AI is responding', () => {
    expect(chat).toContain('if (this.chat.runId)');
    expect(chat).toContain('XopcBrandLoading({ compact: true, reduceMotion: this.layout.reduceMotion })');
    expect(mobileComponents).toContain('XopcLoopi({ extent: this.compact ? 20 : 42');
    expect(mobileComponents).toContain('activePage: !this.reduceMotion');
  });
  it('keeps the composer inside the chat safe-area surface', () => {
    expect(chat.match(/TextArea\(\{ text: this.draft/g)).toHaveLength(1);
    expect(chat).toContain("Column().id('chat-dock-corner-mask').width('100%').height(24).backgroundColor(this.colors.chat.canvas)");
    expect(chat).toContain(".id('chat-composer-shell').width('calc(100% - 24vp)').backgroundColor(this.colors.input)");
    expect(chat).toContain(".id('chat-bottom-surface').width('100%').backgroundColor(Color.Transparent)");
    expect(chat).toContain(".id('chat-bottom-region').width('100%')");
    expect(chat).toContain(".id('chat-reply-clearance')");
    expect(chat).toContain('.height(this.bottomRegionHeight + this.replySpaceHeight)');
    expect(chat).toContain('this.bottomRegionHeight = Number(current.height);');
    expect(chat).toContain("}.id('chat-content-viewport').width('100%').height('100%')");
    expect(chat).toContain('.margin({ bottom: this.bottomRegionHeight + 8 })');
    expect(chat).not.toContain('this.bottomDock()');
    expect(home).not.toContain("id('main-tab-dock')");
    expect(home).not.toContain("id('home-quick-composer')");
    expect(chat).toContain('XopcChatActionPanel({ open: this.panelOpen,');
    expect(actionPanel).toContain("this.attachmentTile('photos', $r('app.string.chat_photos')");
    expect(actionPanel).toContain("this.actionRow('reference-note', $r('app.string.chat_reference_note')");
    expect(chat).not.toContain(".id('chat-composer-voice-call')");
  });

  it('opens the configured personal conversation and ordinary drafts from distinct sidebar controls', () => {
    expect(sidebar).toContain('this.personalAgent?.displayName');
    expect(sidebar).toContain("id('chat-sidebar-personal')");
    expect(sidebar).toContain("id('chat-sidebar-new')");
    expect(sidebar).toContain("item.key !== this.personalAgent?.conversationId");
    expect(home).toContain('this.personalAgent.openOrCreate()');
    expect(home).toContain('this.openConversationFromList(record.conversationId)');
    expect(home).toContain('this.openConversationFromList(id)');
    expect(home).toContain('this.chatRepository.create()');
    expect(chat).toContain(".id('chat-header-new')");
    expect(chat).toContain('this.chat.localDraft && !this.chat.rows.length');
    const profile = sidebar.slice(sidebar.indexOf("id('chat-sidebar-new')"));
    expect(profile).toContain("id('chat-sidebar-profile')");
    expect(profile).toContain("this.go('personal')");
    expect(sidebar).not.toContain("this.shortcut($r('app.string.personal')");
  });

  it('keeps the bottom surface flush with the app safe-area edge', () => {
    expect(home).toMatch(/\.height\(LayoutPolicy\.matchParent\)\s+\.ignoreLayoutSafeArea\(\[LayoutSafeAreaType\.SYSTEM\], \[LayoutSafeAreaEdge\.TOP\]\)/);
    expect(chat).toContain(".margin({ top: 4, bottom: 0 })");
    expect(sidebar).toMatch(/\.backgroundColor\('#66000000'\)\s+\.opacity\(this\.reveal\)\s+\.expandSafeArea\(\[SafeAreaType\.SYSTEM\], \[SafeAreaEdge\.BOTTOM\]\)/);
    expect(sidebar).toMatch(/\.backgroundColor\(this\.colors\.panel\)\s+\.expandSafeArea\(\[SafeAreaType\.SYSTEM\], \[SafeAreaEdge\.BOTTOM\]\)/);
  });

  it('keeps the phone library content transparent over the shared page surface', () => {
    expect(home).toContain('deliveries: this.attention.deliveries');
    expect(notesTab).toContain("}.id('notes-tab-content-viewport').width('100%').height('100%')");
    expect(notesTab).not.toContain('.padding({ bottom: this.bottomInset }).clip(true)');
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

  it('keeps history reachable from the sidebar and reserves the system back edge', () => {
    expect(home).toContain("if (page === 'sessions')");
    expect(home).toContain('onExit: (): void => { this.pathStack.pop(); this.openSidebar(); }');
    expect(home).toContain('layoutState.dismissSidebar = (): boolean => this.closeSidebar();');
    expect(sessions).toContain('.virtualScroll({ totalCount: this.rows.length })');
    expect(sessions).toContain('.cachedCount(5)');
    expect(home).toContain("}.hideTitleBar(true).onBackPressed((): boolean => { if (layoutState.dismissChatOverlay?.()) return true; this.pathStack.pop(); return true; })");
    expect(chat).toContain('canStartChatSidebarPan(finger.globalX - event.offsetX');
  });

  it('centers the conversation create icon without relying on a clipped text glyph', () => {
    const createButton = sessions.slice(sessions.indexOf("SymbolGlyph($r('sys.symbol.plus'))"),
      sessions.indexOf(".id('sessions-new')") + 96);
    expect(createButton).toContain("SymbolGlyph($r('sys.symbol.plus')).fontSize(22)");
    expect(createButton).toContain(".id('sessions-new').width(44).height(44).padding(0)");
    expect(sessions).not.toContain("Button('+').id('sessions-new')");
  });

  it('keeps routine Gateway connection progress quiet and renders capsule voice call and settings actions', () => {
    expect(chat).toContain('if (this.hasConnectionIssue())');
    expect(chat).not.toContain("if (this.chat.connection !== 'connected')");
    expect(chat).toContain("this.chat.connection === 'gateway_update_required' || this.chat.connection.startsWith('error:')");
    const header = chat.slice(chat.indexOf('  voiceCallButton()'), chat.indexOf('  chatWorkspace()'));
    expect(header).toContain("$r('sys.symbol.slider_horizontal_2')");
    expect(header).toContain("$r('sys.symbol.phone')");
    expect(header).toContain(".id('chat-header-actions')");
    expect(header).toContain(".id('chat-header-voice-call')");
    expect(header).toContain('this.startVoiceCall()');
    expect(header.slice(header.indexOf('} else if (this.isStandaloneDraft())'), header.indexOf(".id('chat-header-new')")))
      .toContain('this.voiceCallButton()');
    expect(header).not.toContain(".id('chat-header-search')");
    expect(header).toContain('this.personalSettingsOpen = true');

  });

  it('centers the personal avatar and exposes live attention alongside the ordinary conversation title', () => {
    const header = chat.slice(chat.indexOf('  conversationHeader()'), chat.indexOf('  chatWorkspace()'));
    expect(header).toContain('if (this.personalConversation)');
    expect(header).toContain('Stack({ alignContent: Alignment.Top })');
    expect(header).toContain('XopcPersonalAgentAvatar({ extent: 62');
    expect(header).toContain('this.personalAgent?.displayName');
    expect(header).toContain("$r('app.string.chat_attention_count', this.pendingAttention)");
    expect(header).toContain("this.onNavigate({ page: 'progress', itemId: '' })");
    expect(header).toContain("this.chat.title || $r('app.string.new_chat')");
    expect(home).toContain('pendingAttention: this.pendingAttention');
    expect(home).toContain('return this.attention.pendingCount;');
    expect(home).toContain('XopcProgressView({ activePage: true, model: this.attention');
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

  it('groups attachments and references in one accessible add panel', () => {
    const sourcePicker = actionPanel.indexOf("$r('app.string.chat_add_references')");
    expect(actionPanel).toContain('Scroll()');
    expect(actionPanel).toContain(".id('chat-action-panel')");
    for (const action of ['camera', 'photos', 'document']) {
      const tile = actionPanel.indexOf(`this.attachmentTile('${action}'`);
      expect(tile).toBeGreaterThan(0);
      expect(tile).toBeLessThan(sourcePicker);
    }
    for (const action of ['reference-file', 'reference-note', 'reference-task', 'record-voice']) {
      expect(actionPanel.indexOf(`this.actionRow('${action}'`)).toBeGreaterThan(sourcePicker);
    }
    expect(actionPanel).not.toContain('Swiper(');
    expect(options).toContain("$r('app.string.chat_search_in_conversation')");
  });

  it('keeps voice and rich follow-up capture available while an agent run is active', () => {
    const voiceToggle = chat.slice(chat.indexOf('@Builder\n  voiceToggle()'), chat.indexOf('@Builder\n  composerAddAction()'));
    expect(voiceToggle).not.toContain('!this.chat.runId');
    for (const id of ['photos', 'camera', 'document', 'record-voice']) {
      const action = actionPanel.split('\n').find(line => line.includes(`('${id}',`));
      expect(action).toBeDefined();
      expect(action).not.toContain('!this.chat.runId');
    }
  });
});
