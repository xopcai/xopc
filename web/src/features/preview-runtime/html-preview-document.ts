const FRAGMENT_NAVIGATION_SCRIPT = `<script>
window.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const link = event.target.closest?.('a[href], area[href]');
  const href = link?.getAttribute('href').trim();
  if (!href?.startsWith('#') || link.hasAttribute('download')) return;
  const target = link.getAttribute('target') ?? document.querySelector('base[target]')?.getAttribute('target');
  if (target && target.toLowerCase() !== '_self') return;

  event.preventDefault();
  window.location.assign('about:srcdoc' + href);
});
</script>`;

/** Navigate against the srcdoc URL without relying on a base URL, which the preview CSP forbids. */
export function prepareHtmlPreviewDocument(html: string): string {
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head?.index !== undefined) {
    const insertionPoint = head.index + head[0].length;
    return `${html.slice(0, insertionPoint)}${FRAGMENT_NAVIGATION_SCRIPT}${html.slice(insertionPoint)}`;
  }
  const htmlElement = /<html(?:\s[^>]*)?>/i.exec(html);
  if (htmlElement?.index !== undefined) {
    const insertionPoint = htmlElement.index + htmlElement[0].length;
    return `${html.slice(0, insertionPoint)}<head>${FRAGMENT_NAVIGATION_SCRIPT}</head>${html.slice(insertionPoint)}`;
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return `${doctype[0]}<head>${FRAGMENT_NAVIGATION_SCRIPT}</head>${html.slice(doctype[0].length)}`;
  return `<head>${FRAGMENT_NAVIGATION_SCRIPT}</head>${html}`;
}
