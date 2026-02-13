import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { i18n } from '../utils/i18n';

export interface ConfigSection {
  id: string;
  title: string;
  fields: ConfigField[];
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select';
  description?: string;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
}

@customElement('xopcbot-config')
export class XopcbotConfig extends LitElement {
  @property({ attribute: false }) sections: ConfigSection[] = [];
  @property({ attribute: false }) values: Record<string, unknown> = {};
  @property({ attribute: false }) onSave?: (values: Record<string, unknown>) => void;
  @property({ attribute: false }) onClose?: () => void;

  @state() private _currentSection: string = '';
  @state() private _dirtyFields: Set<string> = new Set();

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._currentSection = this.sections[0]?.id || '';
  }

  override render(): unknown {
    return html`
      <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div class="bg-background rounded-lg shadow-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
          ${this.renderHeader()}
          ${this.renderBody()}
          ${this.renderFooter()}
        </div>
      </div>
    `;
  }

  private renderHeader(): unknown {
    return html`
      <div class="flex items-center justify-between p-4 border-b">
        <h2 class="text-lg font-semibold">${i18n('Configuration')}</h2>
        <button class="p-2 hover:bg-accent rounded" @click=${() => this.onClose?.()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    `;
  }

  private renderBody(): unknown {
    return html`
      <div class="flex flex-1 overflow-hidden">
        <nav class="w-48 border-r p-2 overflow-y-auto">
          ${this.sections.map((section) => html`
            <button
              class="w-full text-left px-3 py-2 rounded ${this._currentSection === section.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}"
              @click=${() => this._currentSection = section.id}
            >
              ${section.title}
            </button>
          `)}
        </nav>

        <div class="flex-1 p-4 overflow-y-auto">
          ${this.renderFields()}
        </div>
      </div>
    `;
  }

  private renderFields(): unknown {
    const section = this.sections.find(s => s.id === this._currentSection);
    if (!section) return null;

    return html`
      <div class="space-y-4">
        <h3 class="font-medium">${section.title}</h3>
        ${section.fields.map((field) => this.renderField(field))}
      </div>
    `;
  }

  private renderField(field: ConfigField): unknown {
    const path = `${section.id}.${field.key}`;
    const value = this._getNestedValue(this.values, field.key);
    const isDirty = this._dirtyFields.has(field.key);

    return html`
      <div class="space-y-1">
        <label class="text-sm font-medium">${field.label}</label>
        ${field.description ? html`<p class="text-xs text-muted-foreground">${field.description}</p>` : ''}
        
        ${field.type === 'text' || field.type === 'password' || field.type === 'number' ? html`
          <input
            type=${field.type === 'password' ? 'password' : 'text'}
            class="w-full border rounded px-3 py-2 bg-background"
            .value=${String(value ?? '')}
            placeholder=${field.placeholder || ''}
            @input=${(e: Event) => this._updateField(field.key, (e.target as HTMLInputElement).value)}
          />
        ` : field.type === 'boolean' ? html`
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              .checked=${Boolean(value)}
              @change=${(e: Event) => this._updateField(field.key, (e.target as HTMLInputElement).checked)}
            />
            <span class="text-sm">${field.description || field.label}</span>
          </label>
        ` : field.type === 'select' ? html`
          <select
            class="w-full border rounded px-3 py-2 bg-background"
            @change=${(e: Event) => this._updateField(field.key, (e.target as HTMLSelectElement).value)}
          >
            ${field.options?.map((opt) => html`
              <option value=${opt.value} ?selected=${value === opt.value}>${opt.label}</option>
            `)}
          </select>
        ` : ''}
      </div>
    `;
  }

  private renderFooter(): unknown {
    return html`
      <div class="flex justify-end gap-2 p-4 border-t">
        <button class="px-4 py-2 border rounded hover:bg-accent" @click=${() => this.onClose?.()}>
          ${i18n('Cancel')}
        </button>
        <button class="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90" @click=${() => this._save()}>
          ${i18n('Save')}
        </button>
      </div>
    `;
  }

  private _getNestedValue(obj: Record<string, unknown>, key: string): unknown {
    return obj[key];
  }

  private _updateField(key: string, value: unknown): void {
    this._dirtyFields.add(key);
    const newValues = { ...this.values };
    (newValues as any)[key] = value;
    this.values = newValues;
  }

  private _save(): void {
    this.onSave?.(this.values);
  }
}
