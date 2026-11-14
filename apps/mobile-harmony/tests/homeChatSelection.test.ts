import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../entry/src/main/ets/view/HomeView.ets', import.meta.url), 'utf8');
const methods = source.slice(source.indexOf('  private switchToChat('), source.indexOf('  @Builder\n  destination('));
const compiled = ts.transpileModule(`class Home { ${methods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const Home = new Function(`${compiled}; return Home;`)();

const personal = { conversationId: 'personal', displayName: 'Ada', state: 'ready' };

function setup(saved = '') {
  const chatRepository = {
    mainConversation: vi.fn(async () => saved),
    saveMainConversation: vi.fn(async (id: string) => { saved = id; }),
    create: vi.fn(),
  };
  return Object.assign(new Home(), {
    chatRepository,
    navigationRevision: 0, chatRequestRevision: 0, chatFocusRevision: 0,
    requestedChatId: '', activeChatId: '', pendingChatId: '', chatReady: false,
    personalAgent: { refresh: vi.fn(async () => {}), openOrCreate: vi.fn(async () => personal), error: '' },
    closeSidebar: vi.fn(), pathStack: { clear: vi.fn() },
  });
}

describe('HarmonyOS home chat selection', () => {
  it('opens or provisions the Personal Agent when there is no remembered selection', async () => {
    const home = setup();
    await home.restoreInitialChat();
    expect(home.personalAgent.refresh).toHaveBeenCalledBefore(home.personalAgent.openOrCreate);
    expect(home.requestedChatId).toBe('personal');
    expect(home.chatReady).toBe(true);
    expect(home.chatRepository.create).not.toHaveBeenCalled();
    expect(home.chatRepository.saveMainConversation).not.toHaveBeenCalled();
  });

  it('restores the saved choice and preserves it across a notification', async () => {
    const home = setup('saved');
    await home.restoreInitialChat();
    expect(home.personalAgent.openOrCreate).not.toHaveBeenCalled();
    expect(home.requestedChatId).toBe('saved');

    home.openConversationFromList('notification-target', false);
    await home.restoreInitialChat();
    expect(home.requestedChatId).toBe('notification-target');
    expect(await home.chatRepository.mainConversation()).toBe('saved');

    home.openConversationFromList('chosen');
    expect(await home.chatRepository.mainConversation()).toBe('chosen');
  });

  it('clears a confirmed missing saved conversation and returns to the Personal Agent', async () => {
    const home = setup('deleted');
    await home.restoreInitialChat();
    await home.restoreInitialChat('deleted');
    expect(await home.chatRepository.mainConversation()).toBe('');
    expect(home.requestedChatId).toBe('personal');
    expect(home.chatReady).toBe(true);
  });

  it('does not let a late startup response overwrite a manual switch', async () => {
    const home = setup();
    let finish!: (id: string) => void;
    home.chatRepository.mainConversation.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    const starting = home.restoreInitialChat();
    home.openConversationFromList('chosen');
    finish('previous');
    await starting;
    expect(home.requestedChatId).toBe('chosen');
    expect(home.chatRepository.saveMainConversation).toHaveBeenCalledExactlyOnceWith('chosen');
  });
});
