import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chat = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');
const personalChatActivity = readFileSync(new URL('../entry/src/main/ets/view/PersonalChatActivity.ets', import.meta.url), 'utf8');
const taskChatHeader = readFileSync(new URL('../entry/src/main/ets/view/TaskChatHeader.ets', import.meta.url), 'utf8');
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
  it('uses the main send action without a follow-up queue or secondary steer action', () => {
    expect(chat).toContain("this.chat.send('', [attachment], []");
    expect(chat).not.toContain("app.string.chat_queue");
    expect(chat).not.toContain("app.string.chat_steer");
    expect(options).not.toContain("onEditQueued");
  });

  it('opens project conversations with the standard chat controls and returns through the project stack', () => {
    const projectDestination = home.slice(home.indexOf("} else if (page === 'project-chat')"),
      home.indexOf("} else if (page === 'task-conversation')"));
    expect(projectDestination).toContain('XopcChatView({ requestedId: (param as XopcMobileRoute).itemId');
    expect(projectDestination).toContain('onOpenSidebar: (): void => { this.openSidebar(); }');
    expect(projectDestination).toContain('onProjectClose: (): void => { this.closeProjectChat(); }');
    expect(projectDestination).not.toContain('embedded: true');
    expect(projectDestination).not.toContain('XopcPageHeader');
    const closeProject = home.slice(home.indexOf('  private closeProjectChat()'), home.indexOf('  private async openTaskChat('));
    expect(closeProject).toContain('this.popActiveStack();');
    expect(closeProject).not.toContain('this.switchToChat(');
    const navigation = chat.slice(chat.indexOf('  navigationButtons()'), chat.indexOf('  private isStandaloneDraft()'));
    expect(navigation).toContain(".id('project-chat-close')");
    expect(navigation).toContain(".id('chat-header-sidebar')");
  });

  it('opens task conversations with the full chat header while retaining task navigation', () => {
    const taskDestination = home.slice(home.indexOf("} else if (page === 'task-conversation')"),
      home.indexOf("} else if (page === 'task-detail')"));
    expect(taskDestination).toContain("requestedId: (param as XopcMobileRoute).prompt ?? ''");
    expect(taskDestination).toContain('taskId: (param as XopcMobileRoute).itemId');
    expect(taskDestination).toContain('this.popActiveStack(); return true;');
    expect(taskDestination).not.toContain('task_open_conversation');
    expect(home).toContain("route.page === 'task-chat' || (route.page === 'tasks' && route.itemId)");
    const tip = chat.indexOf(".id('task-chat-details-tip')");
    expect(tip).toBeGreaterThan(0);
    expect(tip).toBeLessThan(chat.indexOf(".id('chat-composer')"));
    const tipBlock = chat.slice(tip, chat.indexOf(".id('chat-composer')"));
    expect(tipBlock).toContain("this.onNavigate({ page: 'task-detail', itemId: this.taskId })");
    expect(tipBlock).toContain('.height(28).padding({ left: 10, right: 10 }).backgroundColor(this.colors.chat.card)');
    expect(tipBlock).toContain('.borderRadius(this.colors.corner(14)).clipShape(this.colors.cornerClip(14))');
    expect(tipBlock).toContain(".responseRegion({ x: 0, y: -8, width: '100%', height: 44 })");
    const detailDestination = home.slice(home.indexOf("} else if (page === 'task-detail')"),
      home.indexOf("} else if (page === 'task-edit'"));
    expect(detailDestination).toContain("XopcWorkspaceView({ section: 'tasks'");
    expect(detailDestination).toContain('initialId: (param as XopcMobileRoute).itemId');
    expect(detailDestination).toContain('onExit: (): void => { this.popActiveStack(); }');
    expect(taskChatHeader).not.toContain('.bindSheet(');
    expect(taskChatHeader).not.toContain('task-chat-summary-toggle');
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
    expect(jump).toContain('this.resetMessagePosition(); this.saveReadingPosition(); this.onMessageChange();');
  });

  it('shows the jump button when the reader leaves the latest messages', () => {
    expect(chat).toContain('@Local showJumpBottom: boolean = false;');
    expect(chat).toContain('this.showJumpBottom = !this.atBottom && !this.isLatestVisible();');
    expect(chat).toContain('if (!this.atBottom && this.showJumpBottom)');
    expect(chat).toContain('this.resetMessagePosition(); this.saveReadingPosition(); this.onMessageChange();');
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
    expect(chat).toContain(".id('chat-composer-shell').width('100%')");
    expect(chat).toContain('.backgroundColor(this.panelOpen ? Color.Transparent : this.colors.input)');
    expect(chat).toContain(".width('calc(100% - 24vp)').backgroundColor(this.panelOpen ? this.colors.panel : Color.Transparent)");
    expect(chat).toContain(".id('chat-bottom-surface').width('100%').backgroundColor(Color.Transparent)");
    expect(chat).toContain(".id('chat-bottom-region').width('100%')");
    expect(chat).toContain(".id('chat-bottom-clearance')");
    expect(chat).toContain('.height(this.bottomRegionHeight + 12)');
    expect(chat).toContain('this.bottomRegionHeight = Number(current.height);');
    expect(chat).toContain("}.id('chat-content-viewport').width('100%').height('100%')");
    expect(chat).toContain('.margin({ bottom: this.bottomRegionHeight + 8 })');
    expect(chat).not.toContain('this.bottomDock()');
    expect(home).not.toContain("id('main-tab-dock')");
    expect(home).not.toContain("id('home-quick-composer')");
    expect(chat).toContain('XopcChatActionPanel({ open: this.panelOpen,');
    expect(actionPanel).toContain("this.actionTile('photos', $r('app.string.chat_photos')");
    expect(actionPanel).toContain("this.actionTile('reference-note', $r('app.string.chat_reference_note')");
    expect(chat).not.toContain(".id('chat-composer-voice-call')");
  });

  it('keeps slimmed sidebar shortcuts and opens ordinary drafts on session-chat', () => {
    expect(sidebar).not.toContain("this.shortcut($r('app.string.chat_personal_agent')");
    expect(sidebar).toContain(".id('chat-sidebar-' + page)");
    expect(sidebar).toContain("id('chat-sidebar-new')");
    expect(sidebar).toContain("item.key !== this.personalAgent?.conversationId");
    expect(home).toContain('this.personalAgent.openOrCreate()');
    expect(home).toContain('this.openSessionChatFromSidebar(id');
    expect(home).toContain('this.chatRepository.create()');
    expect(chat).toContain('this.chat.localDraft && !this.chat.rows.length');
    const profile = sidebar.slice(sidebar.indexOf("id('chat-sidebar-new')"));
    expect(profile).toContain("id('chat-sidebar-profile')");
    expect(profile).toContain("this.go('settings')");
    expect(sidebar).not.toContain("this.shortcut($r('app.string.personal')");
  });

  it('keeps the bottom surface flush with the app safe-area edge', () => {
    expect(home).toMatch(/\.height\(LayoutPolicy\.matchParent\)\s+\.ignoreLayoutSafeArea\(\[LayoutSafeAreaType\.SYSTEM\], \[LayoutSafeAreaEdge\.TOP\]\)/);
    expect(chat).toContain(".margin({ top: 4, bottom: 0 })");
    expect(sidebar).toMatch(/\.backgroundColor\(this\.colors\.scrim\)\s+\.opacity\(this\.reveal\)\s+\.expandSafeArea\(\[SafeAreaType\.SYSTEM\], \[SafeAreaEdge\.BOTTOM\]\)/);
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
    expect(notesTab).toContain(".padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X }).scrollBar(BarState.Off)");
    expect(notesTab).not.toContain("padding({ left: 20, right: 20, bottom: 24 })");
    expect(sessions).not.toContain("padding({ left: 20, right: 20, bottom: 20 }).cachedCount(5)");
    expect(homeHubs).not.toContain("padding({ left: 20, right: 20, bottom: 28 })");
    expect(personal).not.toContain("padding({ left: 20, right: 20, bottom: 28 })");
  });

  it('scrolls search and low-frequency shortcuts with the paginated sidebar list and reserves the system back edge', () => {
    const list = sidebar.slice(sidebar.indexOf('List({ space: 2 })'), sidebar.indexOf(".id('chat-sidebar-list')"));
    expect(list).toMatch(/List\(\{ space: 2 \}\) \{\s*ListItem\(\) \{\s*Column\(\{ space: 6 \}\)/);
    expect(list).toContain(".id('chat-sidebar-search')");
    expect(list).toContain("this.go('sessions-search')");
    expect(list).toContain("this.shortcut($r('app.string.automations'), $r('sys.symbol.clock'), 'automations')");
    expect(list).toContain("this.shortcut($r('app.string.capability_title'), $r('sys.symbol.square_grid_2x2'), 'capabilities')");
    expect(list).toContain("this.shortcut($r('app.string.about_you'), $r('sys.symbol.person'), 'about-you')");
    expect(list).not.toContain('.sticky(');
    expect(sidebar).not.toContain("$r('app.string.chat_recent_conversations')");
    expect(sidebar).not.toContain(".id('chat-sidebar-sessions')");
    expect(sidebar).not.toContain("$r('app.string.chat_view_more')");
    expect(sidebar).toContain('.virtualScroll({ totalCount: this.recentConversations.length })');
    expect(sidebar).toContain('void this.sessions.load(this.sessions.hasMore)');
    expect(home).toContain("startSearching: page === 'sessions-search'");
    expect(sessions).toContain('this.searchOpen = this.startSearching');
    expect(sessions).toContain("searchId: 'sessions-open-search'");
    expect(home).toContain('onExit: (): void => { this.popActiveStack(); }');
    expect(home).toContain('layoutState.dismissSidebar = (): boolean => this.closeSidebar();');
    expect(sessions).toContain('.virtualScroll({ totalCount: this.rows.length })');
    expect(sessions).toContain('.cachedCount(5)');
    expect(home).toContain("}.hideTitleBar(true).onBackPressed((): boolean => { if (layoutState.dismissChatOverlay?.()) return true; this.popActiveStack(); return true; })");
    expect(chat).toContain('canStartChatSidebarPan(finger.globalX - event.offsetX');
  });

  it('centers the conversation create icon without relying on a clipped text glyph', () => {
    expect(sessions).toContain("actionIcon: $r('sys.symbol.plus')");
    expect(sessions).toContain("actionId: 'sessions-new'");
    expect(sessions).not.toContain("Button('+').id('sessions-new')");
  });

  it('keeps routine Gateway connection progress quiet and limits the chat options to ordinary conversations', () => {
    expect(chat).toContain('if (this.hasConnectionIssue())');
    expect(chat).not.toContain("if (this.chat.connection !== 'connected')");
    expect(chat).toContain("this.chat.connection === 'gateway_update_required' || this.chat.connection.startsWith('error:')");
    const header = chat.slice(chat.indexOf('  voiceCallButton()'), chat.indexOf('  chatWorkspace()'));
    expect(header).toContain("$r('sys.symbol.phone')");
    const actions = header.slice(header.indexOf('  conversationActions()'), header.indexOf('  navigationButtons()'));
    expect(actions).toMatch(/if \(!this\.personalConversation\) \{\s*Button[\s\S]+?\.id\('chat-header-actions'\)/);
    expect(header).toContain(".id('chat-header-voice-call')");
    expect(header).toContain('this.startVoiceCall()');
    expect(header).toContain(".id('chat-header-continuous-read')");
    expect(header).toContain('.accessibilitySelected(this.continuousReadSelected)');
    expect(actions).toContain('this.continuousReadButton()');
    const draftHeader = header.split('} else if (this.isStandaloneDraft())')[1]?.split('} else {')[0];
    expect(draftHeader).toContain('this.navigationButtons()');
    expect(draftHeader).toContain('this.voiceCallButton()');
    expect(draftHeader).toContain('this.continuousReadButton()');
    expect(draftHeader).not.toContain('this.conversationActions()');
    expect(header).not.toContain(".id('chat-header-new')");
    expect(header).not.toContain(".id('chat-header-search')");
    expect(header).toContain("page: 'personal-agent-overview'");
    expect(chat).not.toContain('personalSettingsSheet');
  });

  it('centers the personal avatar and shows agent identity and conditional context in ordinary chat headers without a chat title', () => {
    const header = chat.slice(chat.indexOf('  conversationHeader()'), chat.indexOf('  chatWorkspace()'));
    expect(header).toContain('if (this.personalConversation)');
    expect(header).toContain('Stack({ alignContent: Alignment.Top })');
    expect(header).toContain('XopcPersonalAgentAvatar({ extent: 62');
    expect(header).toContain('this.personalAgent?.displayName');
    expect(header).toContain('XopcPersonalChatActivity({ conversationId: this.chat.selectedId');
    expect(header).toContain('onOpenAttention: (): void => { this.openPersonalOverview(); }');
    expect(header).toContain("page: 'tasks', itemId: taskId");
    expect(header).not.toContain('pendingAttention');
    expect(personalChatActivity).toContain("$r('app.string.chat_attention_count', this.attentionCount)");
    expect(personalChatActivity).toMatch(/Row\(\{ space: 4 \}\) \{\s*if \(this\.model\.working\.length > 0\) \{\s*this\.workingPill\(\)/);
    expect(personalChatActivity).toContain('PERSONAL_WORK_PILL_MAX_WIDTH: number = 156');
    expect(personalChatActivity).toContain('onClick((): void => { this.onOpenTask($$.task.id); })');
    expect(personalChatActivity).not.toContain('statusLabel');
    expect(personalChatActivity).toContain('XopcPersonalWorkPillFill({ animate: this.activePage && !this.reduceMotion })');
    expect(personalChatActivity).toContain('.autoPlay(this.activePage && !this.reduceMotion)');
    const workRow = personalChatActivity.slice(
      personalChatActivity.indexOf('@Builder taskRow('),
      personalChatActivity.indexOf('@Builder workingPill()'),
    );
    expect(workRow).toContain('.height(PERSONAL_WORK_PILL_HEIGHT)');
    expect(workRow).toContain('.borderRadius(this.colors.corner(16)).clipShape(this.colors.cornerClip(16))');
    expect(workRow).toContain(".responseRegion({ x: 0, y: -PERSONAL_WORK_TOUCH_INSET, width: '100%', height: PERSONAL_WORK_TOUCH_HEIGHT })");
    const compactAttention = personalChatActivity.slice(
      personalChatActivity.indexOf(".id('chat-personal-attention-compact')"),
      personalChatActivity.indexOf('} else if (this.attentionCount > 0)'),
    );
    expect(compactAttention).toContain('.constraintSize({ minWidth: PERSONAL_WORK_PILL_HEIGHT }).height(PERSONAL_WORK_PILL_HEIGHT)');
    expect(compactAttention).toContain('.backgroundColor(this.colors.attentionFill)');
    expect(compactAttention).toContain('.borderRadius(this.colors.corner(16)).clipShape(this.colors.cornerClip(16))');
    expect(compactAttention).toContain('.responseRegion([');
    expect(compactAttention).not.toContain('.width(44).height(44)');
    const ordinary = header.slice(header.indexOf('} else if (this.isStandaloneDraft())'));
    expect(ordinary.match(/this\.chatIdentityPill\(\)/g)).toHaveLength(2);
    expect(ordinary).toContain('this.chatContextStripBar(');
    expect(ordinary).not.toContain('this.chat.title');
    expect(ordinary).not.toContain('this.options.agentName()');
    expect(ordinary).not.toContain('this.agentPickerButton()');
    expect(ordinary).toContain('this.conversationActions()');
    const mainChat = home.slice(home.indexOf('requestedId: this.adaConversationId'),
      home.indexOf(".id('home-chat-viewport')"));
    expect(mainChat).not.toContain('pendingAttention');
    expect(home).toContain('return this.attention.pendingCount;');
    expect(home).toContain('XopcWorkbenchView({');
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
    expect(chat).toContain(".bindSheet($$this.sheetOpen, this.optionsSheet, xopcSheetOptions('medium', { height: this.sheetHeight }))");
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
    const feedback = chat.slice(chat.indexOf('  voiceGestureFeedback() {'), chat.indexOf('  private disabledActionIds()'));
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

  it('keeps read-aloud state and playback controls in the header', () => {
    const player = chat.slice(chat.indexOf('  readAloudMenuAction('), chat.indexOf('  conversationActions() {'));
    expect(player).toContain("$r('sys.symbol.speaker_slash')");
    expect(player).toContain("$r('sys.symbol.speaker_wave_2_fill')");
    expect(player).toContain("$r('sys.symbol.waveform')");
    expect(player).toContain("$r('sys.symbol.pause_fill')");
    expect(player).toContain('LoadingProgress()');
    expect(player).toContain('.bindPopup(this.readAloudMenuOpen, {');
    expect(player).toContain('focusable: false');
    expect(player).toContain('showInSubWindow: false');
    expect(player).toContain('.focusOnTouch(false)');
    expect(player).toContain('Text(this.readAloudStatus())');
    expect(player).toContain("'chat-read-aloud-toggle'");
    expect(player).toContain("'chat-read-aloud-stop'");
    expect(player).toContain('this.toggleContinuousRead()');
    expect(chat).toContain('readAloudAction: () => { this.continuousReadButton(); }');
    expect(chat).not.toContain('XopcFloatingAudioCard');
  });

  it('keeps Gateway connection management out of the conversation tab header', () => {
    expect(sessions).not.toContain(".id('drawer-gateways')");
    expect(sessions).not.toContain('connectionModel.openGateways()');
    expect(sessions).not.toContain('gatewaySession.currentProfile()');
  });

  it('fits capture and references into a two-row icon panel', () => {
    expect(actionPanel).toContain(".id('chat-action-panel')");
    expect(actionPanel).toContain(".width('25%').height(84)");
    expect(Array.from(actionPanel.matchAll(/this\.actionTile\('([^']+)'/g), match => match[1])).toEqual([
      'photos', 'camera', 'document', 'record-voice', 'reference-note', 'reference-task', 'reference-file', 'switch-agent',
    ]);
    expect(actionPanel).toContain('if (this.canSwitchAgent)');
    expect(chat).not.toContain('chat-header-agent');
    expect(chat).toContain("if (this.canSwitchAgent) this.openSheet('agent');");
    expect(actionPanel).toContain(".accessibilityLevel(this.open ? 'auto' : 'no-hide-descendants')");
    expect(actionPanel).not.toContain('Scroll()');
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
