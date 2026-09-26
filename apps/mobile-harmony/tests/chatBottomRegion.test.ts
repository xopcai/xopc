import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chat = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');
const options = readFileSync(new URL('../entry/src/main/ets/view/ChatOptions.ets', import.meta.url), 'utf8');
const drawer = readFileSync(new URL('../entry/src/main/ets/view/ChatDrawer.ets', import.meta.url), 'utf8');
const home = readFileSync(new URL('../entry/src/main/ets/view/HomeView.ets', import.meta.url), 'utf8');

describe('chat bottom region composition', () => {
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
    expect(chat).toContain('if (this.atBottom) this.showJumpBottom = false;');
    expect(chat).toContain('else if (offset > 0) this.showJumpBottom = true;');
    expect(chat).toContain('else if (offset < 0) this.showJumpBottom = false;');
    expect(chat).toContain('if (!this.atBottom && this.showJumpBottom)');
    expect(chat).toContain('this.atBottom = true; this.showJumpBottom = false; this.messagesScroller.scrollEdge(Edge.Bottom);');
  });

  it('replaces the jump arrow with an animated brand logo while AI is responding', () => {
    expect(chat).toContain('if (this.chat.runId)');
    expect(chat).toContain('XopcChatRunningLogo({ reduceMotion: this.layout.reduceMotion })');
    expect(chat).toContain("Image($r('app.media.brand_logo_base'))");
    expect(chat).toContain("Image($r('app.media.brand_logo_accent'))");
    expect(chat).toContain('.rotate({ angle: this.accentAngle })');
    expect(chat).toContain('.animation({ duration: this.reduceMotion ? 0 : 1450, curve: Curve.Linear,');
    expect(chat).toContain('iterations: this.reduceMotion ? 1 : -1');
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

  it('uses the home-owned navigation builder and excludes a duplicate floating dock', () => {
    expect(home).toContain('bottomDock: this.chatDock');
    expect(home).toContain('@LocalBuilder\n  chatDock()');
    expect(home).toContain('this.tab === 0 && this.layout.isMainDockVisible(0)');
    expect(home).toContain('this.tab !== 0 && this.layout.isMainDockVisible(this.tab)');
    expect(home.match(/this.tabItem\(/g)).toHaveLength(4);
    expect(home).toContain('.onClick((): void => { this.tab = index; })');
    expect(home).toContain('this.attention.needsUser.length');
  });

  it('removes the outer bottom gap above the keyboard', () => {
    expect(chat).toContain('bottom: this.layout.keyboardVisible ? 0 : 8');
  });

  it('dismisses input on the drawer touch overlay without removing its pan gesture', () => {
    const strip = chat.slice(chat.indexOf(".id('chat-drawer-gesture-strip')"), chat.indexOf('if (this.drawerOpen) {', chat.indexOf(".id('chat-drawer-gesture-strip')")));
    expect(strip).toContain('event.type === TouchType.Down) this.dismissComposer()');
    expect(strip).toContain('PanGesture({ direction: PanDirection.Horizontal, distance: 16 })');
    expect(strip).toContain('if (event.offsetX > 32) this.setDrawer(true)');
  });

  it('keeps routine Gateway connection progress quiet and renders compact header dots', () => {
    expect(chat).toContain('if (this.hasConnectionIssue())');
    expect(chat).not.toContain("if (this.chat.connection !== 'connected')");
    expect(chat).toContain("this.chat.connection === 'gateway_update_required' || this.chat.connection.startsWith('error:')");
    const headerActions = chat.slice(chat.indexOf("Text('···').fontSize(18)"), chat.indexOf(".id('chat-header-actions')"));
    expect(headerActions).toContain("Text('···').fontSize(18).letterSpacing(-2)");
    expect(headerActions).not.toContain("Text('•••')");
  });

  it('shows the conversation title in the header and keeps model selection in the actions sheet', () => {
    const header = chat.slice(chat.indexOf(".id('chat-open-drawer')"), chat.indexOf('if (this.hasConnectionIssue())'));
    expect(header).toContain("Text(this.chat.title || $r('app.string.untitled'))");
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
    expect(chat).not.toContain("height: '80%'");
    expect(chat).toContain('onMode: (mode: string): void => { this.sheetMode = mode; }');
  });

  it('uses a hold-and-slide voice gesture instead of click-to-start recording', () => {
    expect(chat).toContain("@Local voiceDestination: XopcVoiceRecordingDestination = 'send'");
    expect(chat).toContain('.onTouch((event: TouchEvent): void => { this.handleVoiceTouch(event); })');
    expect(chat).toContain("destination === 'text'");
    expect(chat).toContain("destination === 'cancel'");
    expect(chat).toContain('await this.sendVoice(false)');
    expect(chat).not.toContain(".onClick(async (): Promise<void> => { await this.reader.stop(); if (this.visible) this.voice.start");
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

  it('keeps Gateway connection management out of the session drawer header', () => {
    expect(drawer).not.toContain(".id('drawer-gateways')");
    expect(drawer).not.toContain('connectionModel.openGateways()');
    expect(drawer).not.toContain('gatewaySession.currentProfile()');
  });

  it('uses a compact horizontally swipeable action grid with common actions on the first page', () => {
    const panel = chat.slice(chat.indexOf('@Builder\n  actionPanel()'), chat.indexOf('\n  build()', chat.indexOf('@Builder\n  actionPanel()')));
    const secondPage = panel.indexOf("this.actionTile('voice-no-tools'");

    expect(panel).toContain('Swiper()');
    expect(panel).toContain(".id('chat-action-panel').width('100%').height(196).loop(false).autoPlay(false)");
    expect(panel).toContain('new DotIndicator()');
    expect(panel).not.toContain('Scroll()');
    expect(chat).toContain(".width('25%').height(84).padding(2)");
    expect(chat).toContain('}.width(48).height(48)');
    for (const id of ['photos', 'camera', 'document', 'record-voice', 'reference-note', 'reference-task', 'reference-file', 'new-chat']) {
      expect(panel.indexOf(`this.actionTile('${id}'`)).toBeGreaterThan(0);
      expect(panel.indexOf(`this.actionTile('${id}'`)).toBeLessThan(secondPage);
    }
    expect(secondPage).toBeGreaterThan(0);
    expect(panel.indexOf("this.actionTile('voice-with-tools'")).toBeGreaterThan(secondPage);
  });
});
