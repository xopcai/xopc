import { html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { ArtifactElement } from './ArtifactElement.js';
import { i18n } from '../../utils/i18n.js';
import '../MarkdownRenderer';

@customElement('markdown-artifact')
export class MarkdownArtifact extends ArtifactElement {
  @property() override filename = '';

  private _content = '';
  override get content(): string {
    return this._content;
  }
  override set content(value: string) {
    this._content = value;
    this.requestUpdate();
  }

  @state() private viewMode: 'preview' | 'code' = 'preview';

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  private setViewMode(mode: 'preview' | 'code') {
    this.viewMode = mode;
  }

  public getHeaderButtons(): TemplateResult {
    return html`
      <div class="flex items-center gap-2">
        <div class="flex items-center bg-muted rounded-md p-1">
          <button
            class="px-3 py-1 text-xs rounded ${this.viewMode === 'preview' ? 'bg-background shadow-sm' : 'text-muted-foreground'}"
            @click=${() => this.setViewMode('preview')}
          >
            ${i18n('Preview')}
          </button>
          <button
            class="px-3 py-1 text-xs rounded ${this.viewMode === 'code' ? 'bg-background shadow-sm' : 'text-muted-foreground'}"
            @click=${() => this.setViewMode('code')}
          >
            ${i18n('Code')}
          </button>
        </div>
        <button
          class="p-2 hover:bg-muted rounded-md transition-colors"
          @click=${this._copy}
          title="${i18n('Copy')}"  
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
        </button>
        <button
          class="p-2 hover:bg-muted rounded-md transition-colors"
          @click=${this._download}
          title="${i18n('Download')}"  
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
        </button>
      </div>
    `;
  }

  private _copy = async () => {
    try {
      await navigator.clipboard.writeText(this._content);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  private _download = () => {
    const blob = new Blob([this._content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  override render() {
    return html`
      <div class="h-full flex flex-col">
        <div class="flex-1 overflow-auto">
          ${this.viewMode === 'preview'
            ? html`<div class="p-4"><markdown-renderer .content=${this.content}></markdown-renderer></div>`
            : html`<pre class="m-0 p-4 text-xs whitespace-pre-wrap break-words"><code>${this.content}</code></pre>`}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'markdown-artifact': MarkdownArtifact;
  }
}
