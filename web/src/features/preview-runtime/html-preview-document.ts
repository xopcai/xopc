const SRCDOC_BASE_TAG = '<base href="about:srcdoc">';

/** Keep fragment-only links inside the srcdoc document instead of resolving against the preview shell URL. */
export function prepareHtmlPreviewDocument(html: string): string {
  if (/<base(?:\s|>)/i.test(html)) return html;
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head?.index !== undefined) {
    const insertionPoint = head.index + head[0].length;
    return `${html.slice(0, insertionPoint)}${SRCDOC_BASE_TAG}${html.slice(insertionPoint)}`;
  }
  const htmlElement = /<html(?:\s[^>]*)?>/i.exec(html);
  if (htmlElement?.index !== undefined) {
    const insertionPoint = htmlElement.index + htmlElement[0].length;
    return `${html.slice(0, insertionPoint)}<head>${SRCDOC_BASE_TAG}</head>${html.slice(insertionPoint)}`;
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return `${doctype[0]}<head>${SRCDOC_BASE_TAG}</head>${html.slice(doctype[0].length)}`;
  return `<head>${SRCDOC_BASE_TAG}</head>${html}`;
}
