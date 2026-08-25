import type { SessionTimelineItem } from '../../session/transcript-outline.js';
import { TaskConversationRepository } from '../../tasks/task-conversation-repository.js';

import type { GatewaySessionsApi } from './sessions-api.js';

type MessagePage = NonNullable<Awaited<ReturnType<GatewaySessionsApi['getMessagePage']>>>;

export class TaskConversationQueryService {
  constructor(
    private readonly sessions: Pick<GatewaySessionsApi, 'getMessagePage' | 'getTimeline'>,
    private readonly conversations: Pick<TaskConversationRepository, 'listSessions'> = new TaskConversationRepository(),
  ) {}

  async getMessagePage(taskId: string, options: { limit: number; offset: number; before?: number }) {
    const links = this.#executionSessions(taskId);
    if (links.length === 0) return null;
    const probes = await Promise.all(links.map((link) => this.sessions.getMessagePage(link.sessionKey, { limit: 1 })));
    if (probes.some((page) => !page)) return null;
    const pages = probes as MessagePage[];
    const total = pages.reduce((sum, page) => sum + page.pagination.total, 0);
    const end = Math.min(total, Math.max(0, options.before ?? total - options.offset));
    const start = Math.max(0, end - options.limit);
    const messages: MessagePage['session']['messages'] = [];
    let cursor = 0;
    for (let index = 0; index < links.length; index += 1) {
      const sessionTotal = pages[index]!.pagination.total;
      const localStart = Math.max(0, start - cursor);
      const localEnd = Math.min(sessionTotal, end - cursor);
      if (localStart < localEnd) {
        const page = await this.sessions.getMessagePage(links[index]!.sessionKey, {
          offset: sessionTotal - localEnd,
          limit: localEnd - localStart,
        });
        if (!page) return null;
        messages.push(...page.session.messages);
      }
      cursor += sessionTotal;
    }
    const activeIndex = links.findIndex((link) => link.status === 'active');
    const active = pages[activeIndex >= 0 ? activeIndex : pages.length - 1]!;
    return {
      session: { ...active.session, messages },
      pagination: {
        total,
        limit: options.limit,
        offset: options.offset,
        hasMore: start > 0,
        ...(options.before === undefined ? {} : { before: String(end) }),
        ...(start > 0 ? { nextBeforeCursor: String(start) } : {}),
      },
    };
  }

  async getTimeline(taskId: string): Promise<SessionTimelineItem[] | null> {
    const links = this.#executionSessions(taskId);
    if (links.length === 0) return null;
    const output: SessionTimelineItem[] = [];
    let displayOffset = 0;
    let turnOffset = 0;
    for (const [index, link] of links.entries()) {
      const [items, page] = await Promise.all([
        this.sessions.getTimeline(link.sessionKey),
        this.sessions.getMessagePage(link.sessionKey, { limit: 1 }),
      ]);
      if (!items || !page) return null;
      if (index > 0) {
        output.push({
          id: `assignment:${link.id}`,
          kind: 'branch',
          title: link.agentId ? `Execution continued by ${link.agentId}` : 'Execution continued',
          timestamp: link.startedAt,
          depth: 0,
          turn: turnOffset,
          displayIndex: displayOffset,
        });
      }
      output.push(...items.map((item) => ({
        ...item,
        id: `${link.id}:${item.id}`,
        turn: item.turn + turnOffset,
        ...(item.displayIndex === undefined ? {} : { displayIndex: item.displayIndex + displayOffset }),
      })));
      displayOffset += page.pagination.total;
      const highestTurn = items.reduce((max, item) => Math.max(max, item.turn), -1);
      turnOffset += highestTurn + 1;
    }
    return output;
  }

  #executionSessions(taskId: string) {
    return this.conversations.listSessions(taskId)
      .filter((link) => link.role === 'execution')
      .sort((a, b) => a.assignmentEpoch - b.assignmentEpoch || a.startedAt - b.startedAt);
  }
}
