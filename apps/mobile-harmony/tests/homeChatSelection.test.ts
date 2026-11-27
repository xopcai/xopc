import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { isActiveMobileDestination, XopcMobileTabNavState } from '../entry/src/main/ets/common/mobileTabNavigation.ets';

const source = readFileSync(new URL('../entry/src/main/ets/view/HomeView.ets', import.meta.url), 'utf8');
const methods = source.slice(
  source.indexOf('  private async restoreInitialChat('),
  source.indexOf('  private async openOrdinaryChat('),
);
const placeDestination = source.slice(
  source.indexOf('  private placeDestination('),
  source.indexOf('  private updateTabStackMetrics('),
);
const compiled = ts.transpileModule(`class Home { ${placeDestination} ${methods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const Home = new Function('isActiveMobileDestination', `${compiled}; return Home;`)(isActiveMobileDestination);

const personal = { conversationId: 'personal', displayName: 'Ada', state: 'ready' };

function setup() {
  const adaStack = {
    pushPath: vi.fn(),
    replacePath: vi.fn(),
    clear: vi.fn(),
    pop: vi.fn(),
    size: vi.fn(() => 0),
  };
  const conversationsStack = {
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
    tabTopEntries: new Map<string, number>(),
    nextStackEntryId: 0,
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
    conversationsStack,
    notesStack,
    stackFor: (tab: string) => (tab === 'conversations' ? conversationsStack : tab === 'notes' ? notesStack : adaStack),
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

  it('opens ordinary conversations on conversationsStack without mutating AdaRoot state', async () => {
    const home = setup();
    await home.restoreInitialChat();

    home.openSessionChat('ordinary-a');
    expect(home.selectedTab).toBe('conversations');
    expect(home.adaConversationId).toBe('personal');
    expect(home.sessionChatId).toBe('ordinary-a');
    expect(home.conversationsStack.pushPath).toHaveBeenCalledOnce();
    expect(home.adaStack.pushPath).not.toHaveBeenCalled();

    home.openSessionChat('ordinary-b');
    expect(home.selectedTab).toBe('conversations');
    expect(home.adaConversationId).toBe('personal');
    expect(home.sessionChatId).toBe('ordinary-b');
    expect(home.conversationsStack.replacePath).toHaveBeenCalledOnce();
  });

  it('switches to AdaRoot instead of pushing session-chat when opening personal conversation', async () => {
    const home = setup();
    await home.restoreInitialChat();
    home.openSessionChat('ordinary-a');
    home.openSessionChat('personal');
    expect(home.switchToAdaRoot).toHaveBeenCalledOnce();
    expect(home.selectedTab).toBe('ada');
  });

  it('keeps only the selected stack’s top chat active even when the routes share a name and conversation', () => {
    const home = setup();
    home.selectedTab = 'notes';
    home.tabNav.selectedTab = 'notes';
    home.openConversationFromSearch('same-chat');
    const searchChat = home.tabNav.topRoute('notes');
    home.tabTopEntries.set('notes', searchChat.stackEntryId);
    expect(isActiveMobileDestination(home.selectedTab, home.tabTopEntries, searchChat.stackEntryId)).toBe(true);

    home.openSessionChat('same-chat');
    const otherChat = home.tabNav.topRoute('conversations');
    home.tabTopEntries.set('conversations', otherChat.stackEntryId);
    expect(isActiveMobileDestination(home.selectedTab, home.tabTopEntries, searchChat.stackEntryId)).toBe(false);
    expect(isActiveMobileDestination(home.selectedTab, home.tabTopEntries, otherChat.stackEntryId)).toBe(true);

    home.openSessionChat('same-chat');
    const replacement = home.tabNav.topRoute('conversations');
    home.tabTopEntries.set('conversations', replacement.stackEntryId);
    expect(isActiveMobileDestination(home.selectedTab, home.tabTopEntries, otherChat.stackEntryId)).toBe(false);
    expect(isActiveMobileDestination(home.selectedTab, home.tabTopEntries, replacement.stackEntryId)).toBe(true);
  });

  it('promotes a new draft in-place and pops back to conversations root when unavailable', async () => {
    const home = setup();
    await home.restoreInitialChat();
    home.openSessionChat('draft-1');
    const route = home.tabNav.topRoute('conversations');
    home.tabTopEntries.set('conversations', route.stackEntryId);

    home.promoteSessionChatDraft('draft-1', 'persisted-1', route);
    expect(route.itemId).toBe('persisted-1');
    expect(home.sessionChatId).toBe('persisted-1');
    expect(home.conversationsStack.pop).not.toHaveBeenCalled();

    home.conversationsStack.size.mockReturnValue(1);
    home.onSessionChatUnavailable('persisted-1');
    expect(home.conversationsStack.pop).toHaveBeenCalledOnce();
    expect(home.sessionChatId).toBe('');
    expect(home.adaConversationId).toBe('personal');
  });
});
