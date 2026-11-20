import { parseHTML } from 'linkedom';
import MarkdownIt from 'markdown-it';

import type { TaskResearchResult } from '@xopcai/gateway-contract';

import { finalReplyCharacterLimit, isReplyLengthCriterion } from './task-final-reply.js';

const markdown = new MarkdownIt({ html: true });
const plainChat = /^(?:(?:最终)?(?:回复|答复)为纯文本(?:聊天内容)?|(?:use |deliver )(?:a )?plain[- ]text chat (?:reply|response)|(?:the )?(?:final )?(?:chat )?(?:reply|response) (?:is|must be) plain[- ]text)(?:[，,]\s*(?:未生成任何文件|不生成(?:任何)?文件|without (?:any )?(?:files|attachments)))?$/iu;
const noMarkdown = /^(?:(?:最终)?(?:回复|答复)(?:使用纯文本[，,]\s*)?(?:不使用|不得使用|无)\s*Markdown|(?:the )?(?:final )?(?:chat )?(?:reply|response) (?:uses? no|must not use) Markdown)$/iu;
const htmlFilename = /^(?:(?:HTML\s*)?文件名(?:为|是|：|:)\s*|(?:the )?(?:HTML )?(?:file ?name is|file is named)\s+)`?([^\s`/\\]+\.html?)`?$/iu;
const singleHtml = /^(?:(?:交付|发布)(?:一个|一份)?单文件\s*HTML(?:\s*(?:文件|网页))?|(?:deliver|publish) (?:a )?single HTML (?:file|document))$/iu;
const htmlHeadingAndFooter = /^(?:HTML\s*(?:页面)?(?:包含|含有)(?:可见)?标题(?:和|与|及)页脚|(?:the )?HTML (?:page )?(?:has|contains) (?:a )?(?:heading|title) and (?:a )?footer)$/iu;
const inlineCss = /^(?:CSS\s*(?:全部)?(?:内联|内嵌)|CSS\s*(?:必须|须)(?:内联|内嵌)|(?:all )?CSS (?:is|must be) (?:inline|embedded))$/iu;

type Check = TaskResearchResult['checks'][number];
type PublishedFile = { title: string; content?: string };

export function checkTaskDelivery(result: TaskResearchResult, input: {
  files: PublishedFile[];
  publishedFileCount: number;
  chatReplyOnly: boolean;
  zh: boolean;
}): TaskResearchResult {
  const { finalText } = result;
  const { files, zh } = input;
  const length = finalText === undefined ? undefined : Array.from(finalText).length;
  const htmlFiles = files.filter(file => /\.html?$/iu.test(file.title));
  const knowsFinalFiles = result.finalArtifactIds !== undefined || files.length > 0;
  const htmlContent = htmlFiles.length === 1 ? htmlFiles[0].content : undefined;
  let document: ReturnType<typeof parseHTML>['document'] | undefined;
  const checked = (check: Check, passed: boolean, zhNote: string, enNote: string): Check => ({
    ...check, status: passed ? 'passed' : 'failed', claimIds: [], method: 'tool_verified', note: zh ? zhNote : enNote,
  });
  const unverified = (check: Check, zhNote: string, enNote: string): Check => ({
    ...check, status: 'unverified', claimIds: [], note: zh ? zhNote : enNote,
  });
  const checks = result.checks.map((check): Check => {
    const criterion = check.criterion.trim().replace(/[.。]$/u, '');
    const limit = finalReplyCharacterLimit(check.criterion, input.chatReplyOnly);
    if (finalText === undefined && (limit !== undefined || plainChat.test(criterion) || noMarkdown.test(criterion))) {
      return unverified(check, '尚未提交供核验的最终回复。', 'No final reply was submitted for verification.');
    }
    if (limit !== undefined && length !== undefined) {
      if (length > limit || isReplyLengthCriterion(criterion, input.chatReplyOnly)) {
        return checked(check, length <= limit, `最终回复共 ${length} 个字符，上限为 ${limit}。`,
          `The final reply contains ${length} characters. The limit is ${limit}.`);
      }
    }
    if (finalText !== undefined && plainChat.test(criterion)) {
      const excludesFiles = /未生成|不生成|without /iu.test(criterion);
      const hasFiles = (input.chatReplyOnly || excludesFiles) && files.length > 0
        || /未生成|不生成/u.test(criterion) && input.publishedFileCount > 0;
      const passed = !hasFiles && !markdown.parse(finalText, {}).some(token =>
        ['html_block', 'fence', 'code_block'].includes(token.type)
        || token.children?.some(child => ['html_inline', 'image'].includes(child.type)));
      return checked(check, passed, passed ? '最终交付为纯文本聊天回复。' : '最终交付含文件、图片、HTML 或代码块。',
        passed ? 'The final delivery is a plain-text chat reply.' : 'The delivery contains files, images, HTML, or code blocks.');
    }
    if (finalText !== undefined && noMarkdown.test(criterion)) {
      const passed = markdown.parse(finalText, {}).every(token => ['paragraph_open', 'paragraph_close', 'inline'].includes(token.type)
        && (token.children ?? []).every(child => ['text', 'softbreak'].includes(child.type)));
      return checked(check, passed, passed ? '最终回复为无 Markdown 格式的文本。' : '最终回复含 Markdown 排版或 HTML。',
        passed ? 'The final reply is text without Markdown formatting.' : 'The final reply contains Markdown formatting or HTML.');
    }
    const filename = htmlFilename.exec(criterion)?.[1];
    if (filename && knowsFinalFiles) {
      const file = htmlFiles.find(item => item.title === filename);
      return checked(check, Boolean(file), file ? `最终交付包含文件 ${filename}。` : `最终交付中缺少 ${filename}。`,
        file ? `The final delivery lists the file ${filename}.` : `The final publication does not include ${filename}.`);
    }
    const single = singleHtml.test(criterion);
    const css = inlineCss.test(criterion);
    if (single || css || htmlHeadingAndFooter.test(criterion)) {
      if (knowsFinalFiles && (htmlFiles.length === 0 || (single && files.length !== 1))) {
        return checked(check, false, '最终交付未包含要求的 HTML 文件。', 'The final delivery does not contain the required HTML file.');
      }
      if (htmlContent === undefined) return unverified(check, '尚未读取最终 HTML 正文。', 'The final HTML could not be read.');
      document ??= parseHTML(htmlContent).document;
      let passed: boolean;
      let label: string;
      if (single) {
        passed = Boolean(document.querySelector('html > body'));
        label = zh ? '单文件 HTML 结构' : 'single-file HTML structure';
      } else if (css) {
        const style = [...document.querySelectorAll('style')].map(element => element.textContent ?? '').join('\n');
        passed = Boolean(style.trim() || document.querySelector('[style]')) && !document.querySelector('link[rel~="stylesheet" i]')
          && !/@import\b/iu.test(style.replace(/\/\*[\s\S]*?\*\//gu, ''));
        label = zh ? '内联样式' : 'inline CSS';
      } else {
        passed = Boolean(document.querySelector('body h1')?.textContent?.trim() && document.querySelector('body footer')?.textContent?.trim());
        label = zh ? '页面标题和页脚' : 'page heading and footer';
      }
      return checked(check, passed, `最终 HTML 的${label}${passed ? '符合' : '不符合'}要求。`,
        `The published HTML ${passed ? 'meets' : 'does not meet'} the requirement for ${label}.`);
    }
    return check;
  });
  return { ...result, checks };
}
