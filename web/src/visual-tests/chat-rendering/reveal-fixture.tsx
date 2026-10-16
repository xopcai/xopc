import { flushSync } from 'react-dom';
import type { Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { MessageBubble } from '@/features/chat/messages/message-bubble';

export type ChatRevealOptions = { intervalMs?: number; chunk?: number; formatted?: boolean; personal?: boolean };
export type ChatRevealReport = {
  opacityDrops: Array<{ offset: number; char: string; before: number; after: number; segment: string | null }>;
  frames: number;
  complete: boolean;
  maxLeadingDrift: number;
  cursorOpacityDrift: number;
};

/** Sample painted characters, not only DOM identity: opacity must never run backwards. */
export async function runChatRevealFixture(root: Root, { intervalMs = 35, chunk = 1, formatted = false, personal = false }: ChatRevealOptions): Promise<ChatRevealReport> {
  const prefix = '已有的第一句话。';
  const source = prefix + (formatted
    ? '\n\n我们一起分析**这个问题**，让已经显示出来的文字保持稳定。\n\n- 第一项是流式输出。\n- 第二项是渐显动画。\n\nStreaming words should remain stable while new characters arrive progressively.'
    : '我们一起分析这个问题，让已经显示出来的文字保持稳定。'.repeat(4) + ' Streaming words should remain stable while new characters arrive progressively.'.repeat(2));
  const render = (content: string, streaming = true) => flushSync(() => root.render(
    <MemoryRouter><div className="chat-messages mx-auto w-full max-w-3xl p-6">
      <MessageBubble personal={personal} isStreaming={streaming} progress={null}
        message={{ role: 'assistant', renderKey: 'reveal-answer', content: [
          { type: 'text', text: content, segmentId: 'reveal-text', presentation: streaming ? 'pending' : 'answer' },
        ] }} />
    </div></MemoryRouter>,
  ));
  flushSync(() => root.render(null));
  render(prefix);
  const report: ChatRevealReport = { opacityDrops: [], frames: 0, complete: false, maxLeadingDrift: 0, cursorOpacityDrift: 0 };
  const previous = new Map<string, { char: string; opacity: number }>();
  const leading = new Map<number, number>();
  let frame = 0;
  let cursorOpacity: number | undefined;
  const sample = () => {
    report.frames++;
    const cursor = document.querySelector('[data-chat-streaming-cursor]');
    if (cursor) {
      const opacity = Number(getComputedStyle(cursor).opacity);
      if (cursorOpacity !== undefined) report.cursorOpacityDrift = Math.max(report.cursorOpacityDrift, Math.abs(opacity - cursorOpacity));
      cursorOpacity = opacity;
    }
    document.querySelectorAll('.markdown-stream-block').forEach((block, index) => {
      const left = block.getBoundingClientRect().left;
      const before = leading.get(index);
      if (before !== undefined) report.maxLeadingDrift = Math.max(report.maxLeadingDrift, Math.abs(before - left));
      leading.set(index, left);
      let offset = 0;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        let opacity = 1;
        for (let element = node.parentElement; element && element !== block; element = element.parentElement) {
          opacity *= Number(getComputedStyle(element).opacity);
        }
        for (const char of node.textContent ?? '') {
          const key = `${index}:${offset}`;
          const old = previous.get(key);
          if (old?.char === char && old.opacity - opacity > 0.05 && report.opacityDrops.length < 100) {
            report.opacityDrops.push({ offset, char, before: old.opacity, after: opacity, segment: node.parentElement?.getAttribute('data-xopc-segment') ?? null });
          }
          previous.set(key, { char, opacity });
          offset++;
        }
      }
    });
    frame = requestAnimationFrame(sample);
  };
  frame = requestAnimationFrame(sample);
  try {
    for (let end = prefix.length + chunk; end < source.length; end += chunk) {
      render(source.slice(0, end));
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    render(source, false);
    await new Promise(resolve => setTimeout(resolve, 1100));
    const rendered = document.querySelector('.markdown-body')?.textContent?.replace(/\s/g, '');
    report.complete = rendered === source.replace(/\*\*|^[-*] /gm, '').replace(/\s/g, '');
    return report;
  } finally {
    cancelAnimationFrame(frame);
  }
}
