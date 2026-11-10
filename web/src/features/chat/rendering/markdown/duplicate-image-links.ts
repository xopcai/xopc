const IMAGE_LINK_LABEL = /^(?:查看(?:高清|原|大)?图片|查看大图|查看原图|view(?: (?:full[- ]size|original|hd))? image)$/i;

export function isGenericImageLinkLabel(text: string): boolean {
  return IMAGE_LINK_LABEL.test(text);
}

/** Track only generic image links. Ordinary paragraphs never need DOM inspection. */
export function createDuplicateImageLinkTracker() {
  const links = new Set<HTMLAnchorElement>();
  let observer: MutationObserver | undefined;

  function update(link: HTMLAnchorElement) {
    const paragraph = link.closest('p');
    if (!paragraph || paragraph.querySelector('a') !== link) return;
    let hidden = false;
    const label = link.textContent?.trim() ?? '';
    if (label === paragraph.textContent?.trim() && isGenericImageLinkLabel(label)) {
      const sibling = paragraph.nextElementSibling;
      const next = sibling && !sibling.matches('[data-xopc-watermark]') ? sibling
        : paragraph.closest('.markdown-stream-block')?.nextElementSibling?.firstElementChild;
      if (next?.matches('[data-chat-media]')) {
        const images = next.querySelectorAll<HTMLElement>('[data-chat-media-source]');
        hidden = images.length === 1 && images[0].dataset.chatMediaSource === link.getAttribute('href');
      }
    }
    if (paragraph.hidden !== hidden) paragraph.hidden = hidden;
  }

  return (link: HTMLAnchorElement | null) => {
    if (!link) return;
    const paragraph = link.closest('p');
    const boundary = link.closest('.markdown-render-boundary');
    if (!paragraph || !boundary) return;

    links.add(link);
    update(link);
    if (!observer) {
      // The adjacent block can commit independently or resolve an image asynchronously.
      observer = new MutationObserver(() => { for (const candidate of links) update(candidate); });
      observer.observe(boundary, {
        subtree: true,
        childList: true,
        characterData: true,
        attributeFilter: ['href', 'data-chat-media', 'data-chat-media-source'],
      });
    }

    return () => {
      links.delete(link);
      if (paragraph.hidden) paragraph.hidden = false;
      if (!links.size) {
        observer?.disconnect();
        observer = undefined;
      }
    };
  };
}
