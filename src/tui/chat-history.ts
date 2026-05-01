import type { HistoryMessage } from './tui-backend.js';
import { ChatLog } from './components/chat-log.js';

/** Replay persisted transcript into the scroll log (synthetic run ids per assistant row). */
export function appendHistoryToChatLog(
  chatLog: ChatLog,
  messages: HistoryMessage[],
  toolsExpanded: boolean,
): void {
  chatLog.setToolsExpanded(toolsExpanded);

  messages.forEach((hm, idx) => {
    const runId = `history:${idx}`;

    if (hm.role === 'user') {
      chatLog.addUser(hm.content);
      return;
    }

    if (hm.role === 'system') {
      chatLog.addSystem(hm.content);
      return;
    }

    const tools = hm.toolCalls ?? [];
    for (let t = 0; t < tools.length; t++) {
      const tc = tools[t]!;
      const tid = `history:${idx}:t:${t}`;
      chatLog.startTool(tid, tc.name, tc.args ?? {}, runId);
      if (tc.result !== undefined) {
        chatLog.updateToolResult(tid, tc.result, tc.isError ?? false);
      }
    }

    const body = hm.content.trim() ? hm.content : ' ';
    chatLog.finalizeAssistant(body, runId);
  });
}
