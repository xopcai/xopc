// Confirm Dialog Component

import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { getIcon } from '../utils/icons';

export interface ConfirmDialogEventDetail {
  confirmed: boolean;
}

@customElement('confirm-dialog')
export class ConfirmDialog extends LitElement {
  @property({ type: Boolean }) open = false;
  @property({ type: String }) title = 'Confirm';
  @property({ type: String }) message = 'Are you sure?';
  @property({ type: String }) confirmText = 'Confirm';
  @property({ type: String }) cancelText = 'Cancel';
  @property({ type: String }) type: 'danger' | 'warning' | 'info' = 'warning';

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  private _emit(confirmed: boolean): void {
    this.dispatchEvent(new CustomEvent<ConfirmDialogEventDetail>('confirm', {
      detail: { confirmed },
      bubbles: true,
      composed: true,
    }));
    this.open = false;
  }

  private _handleBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) {
      this._emit(false);
    }
  }

  private _getIcon(): string {
    switch (this.type) {
      case 'danger':
        return 'trash';
      case 'warning':
        return 'alertTriangle';
      case 'info':
        return 'info';
      default:
        return 'helpCircle';
    }
  }

  private _getIconColor(): string {
    switch (this.type) {
      case 'danger':
        return 'text-red-500';
      case 'warning':
        return 'text-amber-500';
      case 'info':
        return 'text-blue-500';
      default:
        return 'text-gray-500';
    }
  }

  override render(): unknown {
    if (!this.open) return '';

    return html`
      <div class="modal-backdrop" @click=${this._handleBackdropClick}>
        <div class="modal modal--${this.type}">
          <div class="modal__icon ${this._getIconColor()}">
            ${getIcon(this._getIcon())}
          </div>
          
          <div class="modal__content">
            <h3 class="modal__title">${this.title}</h3>
            <p class="modal__message">${this.message}</p>
          </div>
          
          <div class="modal__actions">
            <button class="btn btn--secondary" @click=${() => this._emit(false)}>
              ${this.cancelText}
            </button>
            <button class="btn btn--${this.type === 'danger' ? 'danger' : 'primary'}" @click=${() => this._emit(true)}>
              ${this.confirmText}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

export default ConfirmDialog;
