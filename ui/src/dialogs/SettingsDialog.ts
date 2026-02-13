import { html, LitElement, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { 
  User, Bot, Plug, Globe, Search, Clock, Puzzle, 
  X, Save, ChevronRight, Check, AlertCircle,
  Settings, Eye, EyeOff, Loader2
} from 'lucide';

export interface SettingsSection {
  id: string;
  title: string;
  icon: string;
  fields: SettingsField[];
}

export interface SettingsField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'textarea';
  description?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  validation?: {
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface SettingsValue {
  [key: string]: any;
}

@customElement('xopcbot-settings')
export class XopcbotSettings extends LitElement {
  @property({ attribute: false }) sections: SettingsSection[] = [];
  @property({ attribute: false }) values: SettingsValue = {};
  @property({ type: Boolean }) loading = false;
  @property({ attribute: false }) onSave?: (values: SettingsValue) => void;
  @property({ attribute: false }) onClose?: () => void;

  @state() private _activeSection: string = '';
  @state() private _dirtyFields: Set<string> = new Set();
  @state() private _showPasswords: Set<string> = new Set();
  @state() private _errors: Map<string, string> = new Map();

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._activeSection = this.sections[0]?.id || '';
  }

  private _getIcon(iconName: string): TemplateResult {
    const icons: Record<string, TemplateResult> = {
      user: html`<User class="w-5 h-5" />`,
      bot: html`<Bot class="w-5 h-5" />`,
      plug: html`<Plug class="w-5 h-5" />`,
      globe: html`<Globe class="w-5 h-5" />`,
      search: html`<Search class="w-5 h-5" />`,
      clock: html`<Clock class="w-5 h-5" />`,
      puzzle: html`<Puzzle class="w-5 h-5" />`,
      settings: html`<Settings class="w-5 h-5" />`,
    };
    return icons[iconName] || html`<Settings class="w-5 h-5" />`;
  }

  override render(): unknown {
    return html`
      <div class="settings-overlay" @click=${(e: Event) => e.target === e.currentTarget && this.onClose?.()}>
        <div class="settings-dialog">
          ${this.renderHeader()}
          <div class="settings-content">
            ${this.renderSidebar()}
            ${this.renderMain()}
          </div>
          ${this.renderFooter()}
        </div>
      </div>
    `;
  }

  private renderHeader(): unknown {
    return html`
      <div class="settings-header">
        <div class="settings-title">
          <Settings class="w-5 h-5" />
          <span>Settings</span>
        </div>
        <button class="close-btn" @click=${() => this.onClose?.()}>
          <X class="w-5 h-5" />
        </button>
      </div>
    `;
  }

  private renderSidebar(): unknown {
    return html`
      <nav class="settings-sidebar">
        ${this.sections.map((section) => html`
          <button
            class="sidebar-item ${this._activeSection === section.id ? 'active' : ''}"
            @click=${() => this._activeSection = section.id}
          >
            ${this._getIcon(section.icon)}
            <span>${section.title}</span>
            <ChevronRight class="w-4 h-4 chevron" />
          </button>
        `)}
      </nav>
    `;
  }

  private renderMain(): unknown {
    const section = this.sections.find(s => s.id === this._activeSection);
    if (!section) return html`<div class="settings-main">No section selected</div>`;

    return html`
      <div class="settings-main">
        <div class="section-header">
          <h2>${section.title}</h2>
          <p class="section-description">Configure your ${section.title.toLowerCase()} settings</p>
        </div>
        
        <div class="fields-grid">
          ${section.fields.map(field => this.renderField(field, section.id))}
        </div>
      </div>
    `;
  }

  private renderField(field: SettingsField, sectionId: string): unknown {
    const fullKey = `${sectionId}.${field.key}`;
    const value = this._getValue(field.key);
    const isDirty = this._dirtyFields.has(fullKey);
    const error = this._errors.get(fullKey);
    const showPassword = this._showPasswords.has(fullKey);

    return html`
      <div class="field-group ${error ? 'has-error' : ''}">
        <div class="field-header">
          <label class="field-label">${field.label}</label>
          ${field.validation?.required ? html`<span class="required-mark">*</span>` : ''}
        </div>
        
        ${field.description ? html`<p class="field-description">${field.description}</p>` : ''}

        ${field.type === 'boolean' ? this.renderBooleanField(field, value, fullKey) : ''}
        
        ${field.type === 'select' ? this.renderSelectField(field, value, fullKey) : ''}
        
        ${field.type === 'textarea' ? this.renderTextareaField(field, value, fullKey) : ''}
        
        ${['text', 'password', 'number'].includes(field.type) 
          ? this.renderInputField(field, value, fullKey, showPassword) 
          : ''}

        ${error ? html`
          <div class="field-error">
            <AlertCircle class="w-4 h-4" />
            <span>${error}</span>
          </div>
        ` : ''}

        ${isDirty && !error ? html`
          <div class="field-dirty">Unsaved changes</div>
        ` : ''}
      </div>
    `;
  }

  private renderInputField(field: SettingsField, value: any, fullKey: string, showPassword: boolean): unknown {
    const inputType = field.type === 'password' 
      ? (showPassword ? 'text' : 'password') 
      : field.type;

    return html`
      <div class="input-wrapper">
        <input
          type=${inputType}
          class="text-input ${field.type === 'password' ? 'has-toggle' : ''}"
          .value=${String(value ?? '')}
          placeholder=${field.placeholder || ''}
          minlength=${field.validation?.min}
          maxlength=${field.validation?.max}
          pattern=${field.validation?.pattern || ''}
          @input=${(e: Event) => this._handleInput(field, fullKey, (e.target as HTMLInputElement).value)}
        />
        ${field.type === 'password' ? html`
          <button 
            type="button" 
            class="password-toggle"
            @click=${() => this._togglePassword(fullKey)}
          >
            ${showPassword ? html`<EyeOff class="w-4 h-4" />` : html`<Eye class="w-4 h-4" />`}
          </button>
        ` : ''}
      </div>
    `;
  }

  private renderTextareaField(field: SettingsField, value: any, fullKey: string): unknown {
    return html`
      <textarea
        class="textarea-input"
        .value=${String(value ?? '')}
        placeholder=${field.placeholder || ''}
        rows="4"
        @input=${(e: Event) => this._handleInput(field, fullKey, (e.target as HTMLTextAreaElement).value)}
      ></textarea>
    `;
  }

  private renderSelectField(field: SettingsField, value: any, fullKey: string): unknown {
    return html`
      <select
        class="select-input"
        .value=${String(value ?? '')}
        @change=${(e: Event) => this._handleInput(field, fullKey, (e.target as HTMLSelectElement).value)}
      >
        ${field.options?.map(opt => html`
          <option value=${opt.value} ?selected=${value === opt.value}>${opt.label}</option>
        `)}
      </select>
    `;
  }

  private renderBooleanField(field: SettingsField, value: any, fullKey: string): unknown {
    return html`
      <label class="toggle-label">
        <input
          type="checkbox"
          class="toggle-input"
          .checked=${Boolean(value)}
          @change=${(e: Event) => this._handleInput(field, fullKey, (e.target as HTMLInputElement).checked)}
        />
        <span class="toggle-switch"></span>
        <span class="toggle-text">${field.description || 'Enable this feature'}</span>
      </label>
    `;
  }

  private renderFooter(): unknown {
    const hasDirty = this._dirtyFields.size > 0;

    return html`
      <div class="settings-footer">
        <button class="btn btn-ghost" @click=${() => this.onClose?.()}>
          Cancel
        </button>
        <button 
          class="btn btn-primary" 
          ?disabled=${this.loading || !hasDirty}
          @click=${() => this._save()}
        >
          ${this.loading ? html`
            <Loader2 class="w-4 h-4 animate-spin" />
            Saving...
          ` : html`
            <Save class="w-4 h-4" />
            Save Changes
          `}
        </button>
      </div>
    `;
  }

  private _getValue(key: string): any {
    return this.values[key];
  }

  private _handleInput(field: SettingsField, fullKey: string, value: any): void {
    // Validate
    if (field.validation?.required && !value) {
      this._errors.set(fullKey, `${field.label} is required`);
    } else if (field.validation?.pattern && value) {
      const regex = new RegExp(field.validation.pattern);
      if (!regex.test(value)) {
        this._errors.set(fullKey, `Invalid format`);
      } else {
        this._errors.delete(fullKey);
      }
    } else {
      this._errors.delete(fullKey);
    }

    this._dirtyFields.add(fullKey);
    this.requestUpdate();
  }

  private _togglePassword(fullKey: string): void {
    if (this._showPasswords.has(fullKey)) {
      this._showPasswords.delete(fullKey);
    } else {
      this._showPasswords.add(fullKey);
    }
    this.requestUpdate();
  }

  private _save(): void {
    // Final validation
    if (this._errors.size > 0) {
      return;
    }

    if (this.onSave) {
      this.onSave(this.values);
    }
  }
}
