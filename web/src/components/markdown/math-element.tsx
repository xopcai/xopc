import { decodeMathSource } from '@xopcai/markdown-math/syntax';
import type { Element } from 'hast';
import { useEffect, useState, type ComponentPropsWithoutRef } from 'react';

import { messages } from '@/i18n/messages';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { useLocaleStore } from '@/stores/locale-store';

import { mathCopyIcons } from './math-copy-icons';

export function MathElement({ node, display = false, children, ...props }: ComponentPropsWithoutRef<'span'> & { node?: Element; display?: boolean }) {
  const labels = messages(useLocaleStore(s => s.language)).chat;
  const [copied, setCopied] = useState<'latex' | 'markdown' | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const source = decodeMathSource(String((node?.properties.dataXopcMathSource ?? node?.properties['data-xopc-math-source']) ?? ''));
  const status = String((node?.properties.dataXopcMath ?? node?.properties['data-xopc-math']) ?? '');
  const title = status === 'pending' ? labels.mathPending : status === 'fallback' ? labels.mathFailed : undefined;
  const copy = async (markdown: boolean) => {
    if (!source) return;
    const ok = await copyTextToClipboard(markdown ? source.raw : source.latex);
    if (ok) setCopied(markdown ? 'markdown' : 'latex');
  };
  const Tag = display ? 'div' : 'span';
  return <Tag {...props} title={title}>
    {children}
    {display && source && <span className="markdown-math-actions" contentEditable={false}>
      <button type="button" title={copied === 'latex' ? labels.messageCopied : labels.mathCopyLatex}
        aria-label={labels.mathCopyLatex} onClick={() => void copy(false)}
        dangerouslySetInnerHTML={{ __html: mathCopyIcons[copied === 'latex' ? 'copied' : 'latex'] }} />
      <button type="button" title={copied === 'markdown' ? labels.messageCopied : labels.mathCopyMarkdown}
        aria-label={labels.mathCopyMarkdown} onClick={() => void copy(true)}
        dangerouslySetInnerHTML={{ __html: mathCopyIcons[copied === 'markdown' ? 'copied' : 'markdown'] }} />
    </span>}
  </Tag>;
}
