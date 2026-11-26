import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { XopcMobileTabNavState } from '../entry/src/main/ets/common/mobileTabNavigation.ets';

const source = readFileSync(new URL('../entry/src/main/ets/view/HomeView.ets', import.meta.url), 'utf8');
const methods = source.slice(
  source.indexOf('  private async restoreInitialChat('),
  source.indexOf('  private async openOrdinaryChat('),
);
const compiled = ts.transpileModule(`class Home { ${methods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const Home = new Function(`${compiled}; return Home;`)();

const personal = { conversationId: 'personal', displayName: 'Ada', state: 'ready' };

function setup() {
  const adaStack = {
    pushPath: vi.fn(),
    replacePath: vi.fn(),
    clear: vi.fn(),
    pop: vi.fn(),
    size: vi.fn(() => 0),
  };
  const notesStack = {
    pushPath: vi.fn(),
    replacePath: vi.fn(),
    clear: vi.fn(),
    pop: vi.fn(),
    size: vi.fn(() => 0),
  };
  const home = Object.assign(new Home(), {
    tabNav: new XopcMobileTabNavState(),
    navigationRevision: 0,
    adaRequestRevision: 0,
    adaFocusRevision: 0,
    sessionChatRequestRevision: 0,
    sessionChatFocusRevision: 0,
    adaConversationId: '',
    adaRequestedDraft: '',
    adaChatReady: false,
    initialChatError: '',
    sessionChatId: '',
    selectedTab: 'ada',
    disposed: false,
    sessionSwitcherOpen: false,
    layout: { reduceMotion: false },
    personalAgent: {
      record: null as typeof personal | null,
      refresh: vi.fn(async () => {}),
      openOrCreate: vi.fn(async () => {
        home.personalAgent.record = personal;
        return personal;
      }),
      error: '',
    },
    closeSidebar: vi.fn(),
    switchToAdaRoot: vi.fn(() => {
      home.selectedTab = 'ada';
      home.tabNav.selectedTab = 'ada';
      home.tabNav.clearTab('ada');
      adaStack.clear();
    }),
    adaStack,
    notesStack,
    stackFor: (tab: string) => (tab === 'notes' ? notesStack : adaStack),
  });
  return home;
}

describe('HarmonyOS home chat selection & state isolation', () => {
  it('anchors AdaRoot permanently to personalAgent.conversationId on cold start', async () => {
    const home = setup();
    await home.restoreInitialChat();
    expect(home.personalAgent.refresh).toHaveBeenCalledBefore(home.personalAgent.openOrCreate);
    expect(home.adaConversationId).toBe('personal');
    expect(home.adaChatReady).toBe(true);
    expect(home.selectedTab).toBe('ada');
  });

  it('opens ordinary conversations in session-chat without mutating AdaRoot state', async () => {
    const home = setup();
    await home.restoreInitialChat();

    home.openSessionChatFromSidebar('ordinary-a');
    expect(home.adaConversationId).toBe('personal');
    expect(home.sessionChatId).toBe('ordinary-a');
    expect(home.adaStack.pushPath).toHaveBeenCalledOnce();

    home.openSessionChatFromSidebar('ordinary-b');
    expect(home.adaConversationId).toBe('personal');
    expect(home.sessionChatId).toBe('ordinary-b');
    expect(home.adaStack.replacePath).toHaveBeenCalledOnce();
  });

  it('switches to AdaRoot instead of pushing session-chat when opening personal conversation', async () => {
    const home = setup();
    await home.restoreInitialChat();
    home.openSessionChatFromSidebar('ordinary-a');
    home.openSessionChatFromSidebar('personal');
    expect(home.switchToAdaRoot).toHaveBeenCalledOnce();
    expect(home.selectedTab).toBe('ada');
  });

  it('promotes a new draft in-place and pops back to AdaRoot when unavailable', async () => {
    const home = setup();
    await home.restoreInitialChat();
    home.openSessionChatFromSidebar('draft-1');
    const route = home.tabNav.topRoute('ada');

    home.promoteSessionChatDraft('draft-1', 'persisted-1', route);
    expect(route.itemId).toBe('persisted-1');
    expect(home.sessionChatId).toBe('persisted-1');
    expect(home.adaStack.pop).not.toHaveBeenCalled();

    home.adaStack.size.mockReturnValue(1);
    home.onSessionChatUnavailable('persisted-1');
    expect(home.adaStack.pop).toHaveBeenCalledOnce();
    expect(home.sessionChatId).toBe('');
    expect(home.adaConversationId).toBe('personal');
  });
});
