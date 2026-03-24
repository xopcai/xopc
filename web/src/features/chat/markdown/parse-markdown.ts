/**
 * Lightweight markdown → HTML (parity with `ui/src/components/MarkdownRenderer.ts`).
 * Output is intended to be passed through DOMPurify before `dangerouslySetInnerHTML`.
 */
export function parseMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang: string, code: string) => {
      return `<pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>`;
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^###### (.*$)/gim, '<h6>$1</h6>')
    .replace(/^##### (.*$)/gim, '<h5>$1</h5>')
    .replace(/^#### (.*$)/gim, '<h4>$1</h4>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/___(.*?)___/g, '<strong><em>$1</em></strong>')
    .replace(/__(.*?)__/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/^---$/gim, '<hr>')
    .replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>')
    .replace(/^\* (.*$)/gim, '<li>$1</li>')
    .replace(/^- (.*$)/gim, '<li>$1</li>')
    .replace(/^\d+\. (.*$)/gim, '<li>$1</li>');

  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
    if (match.includes('*') || match.includes('-')) {
      return `<ul>${match}</ul>`;
    }
    return `<ol>${match}</ol>`;
  });

  const lines = html.split('\n');
  let result = '';
  let inParagraph = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inParagraph) {
        result += '</p>\n';
        inParagraph = false;
      }
      continue;
    }

    if (/^<(h\d|pre|ul|ol|blockquote|hr)/.test(trimmed)) {
      if (inParagraph) {
        result += '</p>\n';
        inParagraph = false;
      }
      result += `${line}\n`;
    } else {
      if (!inParagraph) {
        result += '<p>';
        inParagraph = true;
      }
      result += `${line} `;
    }
  }

  if (inParagraph) {
    result += '</p>\n';
  }

  return result;
}
