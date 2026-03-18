import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../AttachmentTile';
import { AttachmentOverlay } from '../../dialogs/AttachmentOverlay';
import type { Attachment } from '../../utils/attachment-utils';

@customElement('attachment-renderer')
export class AttachmentRenderer extends LitElement {
  @property({ attribute: false }) attachments: Attachment[] = [];

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override render(): unknown {
    if (!this.attachments?.length) return null;

    const images = this.attachments.filter(att => 
      att.type === 'image' || att.mimeType?.startsWith('image/')
    );
    const documents = this.attachments.filter(att => 
      att.type !== 'image' && !att.mimeType?.startsWith('image/')
    );

    return html`
      <div class="flex flex-col gap-2 mt-2">
        ${images.length > 0 ? this._renderImageGallery(images) : ''}
        ${documents.length > 0 ? this._renderDocumentList(documents) : ''}
      </div>
    `;
  }

  private _renderImageGallery(images: Attachment[]): unknown {
    const count = images.length;
    let galleryClass = 'single';
    if (count === 2) galleryClass = 'double';
    else if (count === 3) galleryClass = 'triple';
    else if (count >= 4) galleryClass = 'quad';

    return html`
      <div class="image-gallery ${galleryClass}">
        ${images.map((img) => html`
          <attachment-tile
            .attachment=${img}
            @attachment-click=${() => this._handleAttachmentClick(img)}
          ></attachment-tile>
        `)}
      </div>
    `;
  }

  private _renderDocumentList(documents: Attachment[]): unknown {
    return html`
      <div class="flex flex-wrap gap-2">
        ${documents.map((doc) => html`
          <attachment-tile
            .attachment=${doc}
            @attachment-click=${() => this._handleAttachmentClick(doc)}
          ></attachment-tile>
        `)}
      </div>
    `;
  }

  private _handleAttachmentClick(attachment: Attachment): void {
    AttachmentOverlay.open(attachment);
  }
}
