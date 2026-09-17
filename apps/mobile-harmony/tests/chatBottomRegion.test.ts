import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chat = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');
const home = readFileSync(new URL('../entry/src/main/ets/view/HomeView.ets', import.meta.url), 'utf8');

describe('chat bottom region composition', () => {
  it('floats a light neutral jump button over a transparent message viewport', () => {
    expect(chat).toContain('Stack({ alignContent: Alignment.Bottom })');
    expect(chat).toContain(".id('chat-message-list').height('100%')");
    expect(chat).toContain(".id('chat-message-viewport').layoutWeight(1).width('100%').backgroundColor(Color.Transparent)");
    const jump = chat.slice(chat.indexOf(".id('chat-jump-bottom')"), chat.indexOf(".id('chat-message-viewport')"));
    expect(jump).toContain(".backgroundColor($r('app.color.grouped'))");
    expect(chat).toContain("Text('↓').fontSize(20).fontColor($r('app.color.secondary'))");
    expect(jump).toContain('.height(36).width(36)');
    expect(jump).toContain('.responseRegion({ x: -4, y: -4, width: 44, height: 44 })');
    expect(jump).toContain('this.messagesScroller.scrollEdge(Edge.Bottom)');
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
});
