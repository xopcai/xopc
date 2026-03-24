import { html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { getIcon } from '../utils/icons.js';
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

  private _card(
    icon: string,
    titleId: string,
    title: string,
    subtitle: string,
    body: TemplateResult,
  ): TemplateResult {
    return html`
      <section class="channel-card" aria-labelledby=${titleId}>
        <div class="channel-card__header">
          <div class="channel-card__headline">
            <span class="channel-card__icon" aria-hidden="true">${getIcon(icon)}</span>
            <div class="channel-card__titles">
              <h3 class="channel-card__title" id=${titleId}>${title}</h3>
              <p class="channel-card__subtitle">${subtitle}</p>
            </div>
          </div>
        </div>
        <div class="channel-card__body">
          <div class="channel-card__stack">${body}</div>
        </div>
      </section>
    `;
  }

  override render() {
    const s = this.settings;

    const modelsBody = html`
      <div class="field-group">
        <div class="field-header"><label class="field-label" for="agent-model">${t('settings.fields.model')}</label></div>
        <model-selector
          id="agent-model"
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
    `;

    const workspaceBody = html`
      <div class="field-group">
        <div class="field-header"><label class="field-label" for="agent-workspace">${t('settings.fields.workspace')}</label></div>
        <input id="agent-workspace" class="text-input" type="text" .value=${s.workspace}
          @change=${(e: Event) => this._field('workspace', (e.target as HTMLInputElement).value)} />
        <p class="field-desc">${t('settings.descriptionsFields.workspace')}</p>
      </div>
      <div class="field-group">
        <div class="field-header"><label class="field-label" for="agent-media-mb">${t('settings.fields.mediaMaxMb')}</label></div>
        <input id="agent-media-mb" class="text-input" type="number" min="1" step="1" .value=${s.mediaMaxMb ?? ''}
          placeholder="20"
          @change=${(e: Event) => {
            const v = (e.target as HTMLInputElement).value;
            this._field('mediaMaxMb', v === '' ? undefined : parseFloat(v));
          }} />
        <p class="field-desc">${t('settings.descriptionsFields.mediaMaxMb')}</p>
      </div>
    `;

    const generationBody = html`
      <div class="settings-field-row">
        <div class="field-group">
          <div class="field-header"><label class="field-label" for="agent-max-tokens">${t('settings.fields.maxTokens')}</label></div>
          <input id="agent-max-tokens" class="text-input" type="number" .value=${s.maxTokens}
            @change=${(e: Event) => this._field('maxTokens', parseInt((e.target as HTMLInputElement).value))} />
          <p class="field-desc">${t('settings.descriptionsFields.maxTokens')}</p>
        </div>
        <div class="field-group">
          <div class="field-header"><label class="field-label" for="agent-temperature">${t('settings.fields.temperature')}</label></div>
          <input id="agent-temperature" class="text-input" type="number" step="0.1" min="0" max="2" .value=${s.temperature}
            @change=${(e: Event) => this._field('temperature', parseFloat((e.target as HTMLInputElement).value))} />
          <p class="field-desc">${t('settings.descriptionsFields.temperature')}</p>
        </div>
      </div>
      <div class="field-group">
        <div class="field-header"><label class="field-label" for="agent-max-tools">${t('settings.fields.maxToolIterations')}</label></div>
        <input id="agent-max-tools" class="text-input" type="number" .value=${s.maxToolIterations}
          @change=${(e: Event) => this._field('maxToolIterations', parseInt((e.target as HTMLInputElement).value))} />
        <p class="field-desc">${t('settings.descriptionsFields.maxToolIterations')}</p>
      </div>
    `;

    const behaviorBody = html`
      <div class="field-group">
        <div class="field-header"><label class="field-label" for="agent-thinking">${t('settings.fields.thinkingDefault')}</label></div>
        <select id="agent-thinking" class="select-input" .value=${s.thinkingDefault || 'medium'}
          @change=${(e: Event) => this._field('thinkingDefault', (e.target as HTMLSelectElement).value)}>
          <option value="off">Off</option>
          <option value="minimal">Minimal</option>
          <option value="low">Low</option>
          <option value="medium">Medium (default)</option>
          <option value="high">High</option>
          <option value="xhigh">X-High</option>
          <option value="adaptive">Adaptive</option>
        </select>
        <p class="field-desc">${t('settings.descriptionsFields.thinkingDefault')}</p>
      </div>
      <div class="field-group">
        <div class="field-header"><label class="field-label" for="agent-reasoning">${t('settings.fields.reasoningDefault')}</label></div>
        <select id="agent-reasoning" class="select-input" .value=${s.reasoningDefault || 'off'}
          @change=${(e: Event) => this._field('reasoningDefault', (e.target as HTMLSelectElement).value)}>
          <option value="off">Off</option>
          <option value="on">On</option>
          <option value="stream">Stream</option>
        </select>
        <p class="field-desc">${t('settings.descriptionsFields.reasoningDefault')}</p>
      </div>
      <div class="field-group">
        <div class="field-header"><label class="field-label" for="agent-verbose">${t('settings.fields.verboseDefault')}</label></div>
        <select id="agent-verbose" class="select-input" .value=${s.verboseDefault || 'off'}
          @change=${(e: Event) => this._field('verboseDefault', (e.target as HTMLSelectElement).value)}>
          <option value="off">Off</option>
          <option value="on">On</option>
          <option value="full">Full</option>
        </select>
        <p class="field-desc">${t('settings.descriptionsFields.verboseDefault')}</p>
      </div>
    `;

    return html`
      <div class="section-content">
        <div class="section-header">
          <h2>${t('settings.sections.agent')}</h2>
          <p class="section-desc">${t('settings.descriptions.agent')}</p>
        </div>

        <div class="channels-layout">
          ${this._card(
            'cpu',
            'agent-card-models',
            t('settings.agentUi.cardModelsTitle'),
            t('settings.agentUi.cardModelsSubtitle'),
            modelsBody,
          )}
          ${this._card(
            'folder',
            'agent-card-workspace',
            t('settings.agentUi.cardWorkspaceTitle'),
            t('settings.agentUi.cardWorkspaceSubtitle'),
            workspaceBody,
          )}
          ${this._card(
            'layers',
            'agent-card-generation',
            t('settings.agentUi.cardGenerationTitle'),
            t('settings.agentUi.cardGenerationSubtitle'),
            generationBody,
          )}
          ${this._card(
            'zap',
            'agent-card-behavior',
            t('settings.agentUi.cardBehaviorTitle'),
            t('settings.agentUi.cardBehaviorSubtitle'),
            behaviorBody,
          )}
        </div>
      </div>
    `;
  }
}
