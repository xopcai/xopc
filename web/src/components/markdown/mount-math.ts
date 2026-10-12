import { MAX_MESSAGE_MATH } from '@xopcai/markdown-math/policy';
import { renderMathHtml } from '@xopcai/markdown-math/render';
import { decodeMathSource } from '@xopcai/markdown-math/syntax';

import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

import { mathCopyIcons } from './math-copy-icons';

export function mountMathNodes(root: HTMLElement, streaming: boolean, labels: {
  mathCopyLatex: string; mathCopyMarkdown: string; mathPending: string; mathFailed: string; messageCopied: string;
}): void {
  const placeholders = root.querySelectorAll<HTMLElement>('code[data-xopc-math-source]');
  let count = 0;
  for (const placeholder of placeholders) {
    const source = decodeMathSource(placeholder.dataset.xopcMathSource ?? '');
    if (!source) continue;
    const template = document.createElement('template');
    template.innerHTML = renderMathHtml(source, { streaming }, ++count > MAX_MESSAGE_MATH);
    const element = template.content.firstElementChild as HTMLElement;
    if (element.dataset.xopcMath === 'pending') element.title = labels.mathPending;
    if (element.dataset.xopcMath === 'fallback') element.title = labels.mathFailed;
    if (source.display) {
      const actions = document.createElement('span'); actions.className = 'markdown-math-actions';
      for (const [label, value, icon] of [[labels.mathCopyLatex, source.latex, mathCopyIcons.latex], [labels.mathCopyMarkdown, source.raw, mathCopyIcons.markdown]]) {
        const button = document.createElement('button'); button.type = 'button'; button.title = label;
        button.setAttribute('aria-label', label); button.innerHTML = icon;
        let timer: number | undefined;
        button.addEventListener('click', () => {
          void copyTextToClipboard(value).then(ok => {
            if (!ok || !button.isConnected) return;
            button.innerHTML = mathCopyIcons.copied; button.title = labels.messageCopied;
            window.clearTimeout(timer);
            timer = window.setTimeout(() => {
              if (button.isConnected) { button.innerHTML = icon; button.title = label; }
            }, 2000);
          });
        });
        actions.appendChild(button);
      }
      element.appendChild(actions);
    }
    const target = placeholder.parentElement?.tagName === 'PRE' ? placeholder.parentElement : placeholder;
    target.replaceWith(element);
  }
}
