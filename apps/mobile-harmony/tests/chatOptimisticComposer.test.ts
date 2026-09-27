import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';

const source = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');
const methods = source.slice(source.indexOf('  private async send(delivery:'), source.indexOf('  private addReference('));
const compiled = ts.transpileModule(`class Handler { ${methods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const Handler = new Function(`${compiled}; return Handler;`)();

describe('optimistic composer handoff', () => {
  it('clears text and attachments on enqueue, without clearing the next draft on failure', async () => {
    let finish!: (sent: boolean) => void;
    const view = Object.assign(new Handler(), {
      restoringDraft: false, draft: 'first', attachments: [{ name: 'photo' }], refs: [{ sourceId: 'note' }],
      chat: { selectedId: 'one', send: vi.fn((_text, _files, _delivery, _refs, enqueued) => {
        enqueued(); return new Promise(resolve => { finish = resolve; });
      }) },
      palette: { close: vi.fn() }, saveDraft: vi.fn(), setPanel: vi.fn(), visible: true,
      options: { refreshQueue: vi.fn() },
    });
    const sending = view.send();
    expect(view.draft).toBe(''); expect(view.attachments).toEqual([]); expect(view.refs).toEqual([]);
    expect(view.saveDraft).toHaveBeenCalledOnce();
    view.draft = 'next draft'; finish(false); await sending;
    expect(view.draft).toBe('next draft');
  });
  it('leaves the draft intact when the viewmodel refuses to enqueue', async () => {
    const view = Object.assign(new Handler(), {
      restoringDraft: false, draft: 'keep', attachments: [], refs: [],
      chat: { selectedId: 'one', send: vi.fn(async () => false) },
    });
    await view.send(); expect(view.draft).toBe('keep');
  });
  it('places failed-send retry before the user bubble and keeps the composer editable', () => {
    expect(source.indexOf(".id('chat-message-retry-' + item.item.id)")).toBeLessThan(source.indexOf(".id('chat-user-bubble-' + item.item.id)"));
    expect(source).toContain('this.chat.retrySend(id)');
    expect(source).toContain('.enabled(!this.restoringDraft).backgroundColor(Color.Transparent)');
  });
});
