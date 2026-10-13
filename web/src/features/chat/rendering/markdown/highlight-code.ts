import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

for (const [name, language] of Object.entries({ bash, css, javascript, json, markdown, plaintext, typescript, xml })) {
  hljs.registerLanguage(name, language);
}
hljs.registerAliases(['html'], { languageName: 'xml' });
hljs.registerAliases(['js', 'jsx'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['md'], { languageName: 'markdown' });

export function highlightCode(code: string, language: string): string {
  return hljs.highlight(code, { language: hljs.getLanguage(language) ? language : 'plaintext' }).value;
}
