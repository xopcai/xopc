import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../utils/i18n.js';
import '../components/ModelSelector.js';
import type { SettingsData } from './types.js';

@customElement('agent-section')
export class AgentSection extends LitElement {
  @property({ attribute: false }) settings!: SettingsData;
  @property({ attribute: false }) token?: string;
  @property({ attribute: false }) onChange!: (path: string, value: unknown) => void;

  createRenderRoot() { return this; }

  private _field(path: string, value: unknown) { this.onChange(path, value); }

  override render() {
    const s = this.settings;
    return html`
      <div class="section-content">
        <div class="section-header">
          <h2>${t('settings.sections.agent')}</h2>
          <p class="section-desc">${t('settings.descriptions.agent')}</p>
        </div>
        <div class="fields-grid">

          <div class="field-group">
            <div class="field-header"><label class="field-label">${t('settings.fields.model')}</label></div>
            <model-selector
              .value=${s.model}
              .filter=${'configured'}
              .token=${this.token}
              @change=${(e: CustomEvent) => this._field('model', e.detail.modelId)}
            ></model-selector>
            <p class="field-desc">${t('settings.descriptionsFields.model')}</p>
          </div>

          <div class="field-group">
            <div class="field-header"><label class="field-label">${t('settings.fields.imageModel')}</label></div>
            <model-selector
              .value=${s.imageModel || ''}
              .filter=${'configured'}
              .token=${this.token}
              @change=${(e: CustomEvent) => this._field('imageModel', e.detail.modelId)}
            ></model-selector>
            <p class="field-desc">${t('settings.descriptionsFields.imageModel')}</p>
          </div>

          <div class="field-group">
            <div class="field-header"><label class="field-label">${t('settings.fields.imageGenerationModel')}</label></div>
            <model-selector
              .value=${s.imageGenerationModel || ''}
              .filter=${'configured'}
              .token=${this.token}
              @change=${(e: CustomEvent) => this._field('imageGenerationModel', e.detail.modelId)}
            ></model-selector>
            <p class="field-desc">${t('settings.descriptionsFields.imageGenerationModel')}</p>
          </div>

          <div class="field-group">
            <div class="field-header"><label class="field-label">${t('settings.fields.mediaMaxMb')}</label></div>
            <input class="text-input" type="number" min="1" step="1" .value=${s.mediaMaxMb ?? ''}
              placeholder="20"
              @change=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                this._field('mediaMaxMb', v === '' ? undefined : parseFloat(v));
              }} />
            <p class="field-desc">${t('settings.descriptionsFields.mediaMaxMb')}</p>
          </div>

          <div class="field-group">
            <div class="field-header"><label class="field-label">${t('settings.fields.workspace')}</label></div>
            <input class="text-input" type="text" .value=${s.workspace}
              @change=${(e: Event) => this._field('workspace', (e.target as HTMLInputElement).value)} />
          </div>

          <div class="settings-field-row">
            <div class="field-group">
              <div class="field-header"><label class="field-label">${t('settings.fields.maxTokens')}</label></div>
              <input class="text-input" type="number" .value=${s.maxTokens}
                @change=${(e: Event) => this._field('maxTokens', parseInt((e.target as HTMLInputElement).value))} />
            </div>
            <div class="field-group">
              <div class="field-header"><label class="field-label">${t('settings.fields.temperature')}</label></div>
              <input class="text-input" type="number" step="0.1" min="0" max="2" .value=${s.temperature}
                @change=${(e: Event) => this._field('temperature', parseFloat((e.target as HTMLInputElement).value))} />
            </div>
          </div>

          <div class="field-group">
            <div class="field-header"><label class="field-label">${t('settings.fields.maxToolIterations')}</label></div>
            <input class="text-input" type="number" .value=${s.maxToolIterations}
              @change=${(e: Event) => this._field('maxToolIterations', parseInt((e.target as HTMLInputElement).value))} />
          </div>

          <div class="field-group">
            <div class="field-header"><label class="field-label">${t('settings.fields.thinkingDefault')}</label></div>
            <select class="select-input" .value=${s.thinkingDefault || 'medium'}
              @change=${(e: Event) => this._field('thinkingDefault', (e.target as HTMLSelectElement).value)}>
              <option value="off">Off</option>
              <option value="minimal">Minimal</option>
              <option value="low">Low</option>
              <option value="medium">Medium (default)</option>
              <option value="high">High</option>
              <option value="xhigh">X-High</option>
              <option value="adaptive">Adaptive</option>
            </select>
          </div>

          <div class="field-group">
            <div class="field-header"><label class="field-label">${t('settings.fields.reasoningDefault')}</label></div>
            <select class="select-input" .value=${s.reasoningDefault || 'off'}
              @change=${(e: Event) => this._field('reasoningDefault', (e.target as HTMLSelectElement).value)}>
              <option value="off">Off</option>
              <option value="on">On</option>
              <option value="stream">Stream</option>
            </select>
            <p class="field-desc">${t('settings.descriptionsFields.reasoningDefault') || 'Whether to show model reasoning'}</p>
          </div>

          <div class="field-group">
            <div class="field-header"><label class="field-label">${t('settings.fields.verboseDefault')}</label></div>
            <select class="select-input" .value=${s.verboseDefault || 'off'}
              @change=${(e: Event) => this._field('verboseDefault', (e.target as HTMLSelectElement).value)}>
              <option value="off">Off</option>
              <option value="on">On</option>
              <option value="full">Full</option>
            </select>
          </div>

        </div>
      </div>
    `;
  }
}
