import type { TuiBackend } from './tui-backend.js';

export function createTuiSideChat(context: {
  client: Pick<TuiBackend, 'sideQuery'>;
  conversationId: () => string;
  sessionVersion?: () => number;
  input: (title: string) => Promise<string | undefined>;
  stream?: (read: () => string, cancel: () => void) => void;
  show: (answer: string, followUp: () => void) => void;
  notice: (message: string) => void;
}) {
  let generation = 0;
  let active: AbortController | undefined;
  return async (initialQuestion?: string): Promise<void> => {
    active?.abort();
    const conversationId = context.conversationId();
    const sessionVersion = context.sessionVersion?.();
    const version = ++generation;
    const current = () => version === generation && conversationId === context.conversationId()
      && sessionVersion === context.sessionVersion?.();
    const history: Array<{ role: 'user' | 'assistant'; text: string }> = [];
    const ask = async (question?: string): Promise<void> => {
      question = question?.trim() || await context.input('Side question · main conversation is unchanged');
      if (!question?.trim() || !current()) return;
      const background = history.length
        ? `Previous ephemeral side conversation:\n${history.map(item => `[${item.role}] ${item.text}`).join('\n\n').slice(-24000)}\n\nCurrent side question:\n${question}`
        : question;
      const controller = new AbortController();
      active = controller;
      let streamed = '';
      context.stream?.(() => streamed || 'Waiting for the side answer… · Escape cancels', () => controller.abort());
      const watch = setInterval(() => { if (!current()) controller.abort(); }, 100); watch.unref();
      if (!context.stream) context.notice('Side question running…');
      try {
        const answer = await context.client.sideQuery(conversationId, background, { signal: controller.signal, onDelta: delta => { streamed = (streamed + delta).slice(-1_000_000); } });
        if (!current() || controller.signal.aborted) return;
        if (answer.error) throw new Error(answer.error);
        history.push({ role: 'user', text: question }, { role: 'assistant', text: answer.text });
        if (history.length > 10) history.splice(0, history.length - 10);
        context.show(answer.text, () => { void ask(); });
      } catch (error) {
        if (current() && !controller.signal.aborted) context.notice(`Side question failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally { clearInterval(watch); if (active === controller) active = undefined; }
    };
    await ask(initialQuestion);
  };
}
