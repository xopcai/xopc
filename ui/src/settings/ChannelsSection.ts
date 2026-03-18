import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { getIcon } from '../utils/icons.js';
import type { SettingsData, DmPolicy, GroupPolicy, ReplyToMode, StreamMode } from './types.js';

@customElement('channels-section')
export class ChannelsSection extends LitElement {
  @property({ attribute: false }) settings!: SettingsData;
  @property({ attribute: false }) onChange!: (path: string, value: unknown) => void;

  // Token visibility state (local, not @state to avoid full re-render)
  private _showToken = false;
  private _copied = false;

  createRenderRoot() { return this; }

  private _field(path: string, value: unknown) { this.onChange(path, value); }

  private _toggleToken() { this._showToken = !this._showToken; this.requestUpdate(); }

  private async _copyToken() {
    const token = this.settings.telegram.token;
    if (!token) return;
    await navigator.clipboard.writeText(token).catch(() => {});
    this._copied = true;
    this.requestUpdate();
    setTimeout(() => { this._copied = false; this.requestUpdate(); }, 2000);
  }

  override render() {
    const tg = this.settings.telegram;
    return html`
      <div class="section-content">
        <div class="section-header"><h2>Channels</h2></div>
        <div class="fields-grid">${this._renderTelegram()}</div>
      </div>
    `;
  }

  private _renderTelegram() {
    const tg = this.settings.telegram;
    return html`
      <div class="channel-section">
        <label class="toggle-label">
          <input class="toggle-input" type="checkbox" .checked=${tg.enabled}
            @change=${(e: Event) => this._field('telegram.enabled', (e.target as HTMLInputElement).checked)} />
          <span class="toggle-switch"></span>
          <span class="toggle-text">Enable Telegram</span>
        </label>

        ${tg.enabled ? html`
          <div class="channel-fields" style="margin-top:1.5rem;padding-left:1rem;border-left:2px solid var(--border-color);">

            <div class="field-group">
              <div class="field-header"><label class="field-label">Bot Token <span class="required-mark">*</span></label></div>
              <div class="input-with-actions">
                <input class="text-input" type="${this._showToken ? 'text' : 'password'}" .value=${tg.token}
                  placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                  @change=${(e: Event) => this._field('telegram.token', (e.target as HTMLInputElement).value)} />
                <div class="input-actions">
                  ${tg.token ? html`<button class="btn-icon" @click=${this._copyToken} title="${this._copied ? 'Copied!' : 'Copy'}">${getIcon(this._copied ? 'check' : 'copy')}</button>` : ''}
                  <button class="btn-icon" @click=${this._toggleToken} title="${this._showToken ? 'Hide' : 'Show'}">${getIcon(this._showToken ? 'eyeOff' : 'eye')}</button>
                </div>
              </div>
              <p class="field-desc">Get your token from @BotFather</p>
            </div>

            <div class="field-group">
              <div class="field-header"><label class="field-label">Allow From (User IDs)</label></div>
              <textarea class="textarea-input" rows="2" placeholder="123456789, 987654321"
                .value=${tg.allowFrom.join(', ')}
                @change=${(e: Event) => this._field('telegram.allowFrom',
                  (e.target as HTMLTextAreaElement).value.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
                )}></textarea>
              <p class="field-desc">Comma-separated user IDs allowed to use the bot</p>
            </div>

            <div class="field-group" style="margin-top:1rem;">
              <button class="btn btn-ghost" style="display:flex;align-items:center;gap:.5rem;"
                @click=${() => this._field('telegram.advancedMode', !tg.advancedMode)}>
                ${getIcon(tg.advancedMode ? 'chevronUp' : 'chevronDown')}
                <span>${tg.advancedMode ? 'Hide' : 'Show'} Advanced Settings</span>
              </button>
            </div>

            ${tg.advancedMode ? this._renderAdvanced() : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  private _renderAdvanced() {
    const tg = this.settings.telegram;
    const dmOpts: { value: DmPolicy; label: string }[] = [
      { value: 'pairing', label: 'Pairing' }, { value: 'allowlist', label: 'Allowlist' },
      { value: 'open', label: 'Open' }, { value: 'disabled', label: 'Disabled' },
    ];
    const groupOpts: { value: GroupPolicy; label: string }[] = [
      { value: 'open', label: 'Open' }, { value: 'disabled', label: 'Disabled' }, { value: 'allowlist', label: 'Allowlist' },
    ];
    const replyOpts: { value: ReplyToMode; label: string }[] = [
      { value: 'off', label: 'Off' }, { value: 'first', label: 'First' }, { value: 'all', label: 'All' },
    ];
    const streamOpts: { value: StreamMode; label: string }[] = [
      { value: 'off', label: 'Off' }, { value: 'partial', label: 'Partial' }, { value: 'block', label: 'Block' },
    ];

    return html`
      <div style="margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid var(--border-color);">

        <div class="field-group">
          <div class="field-header"><label class="field-label">API Root</label></div>
          <input class="text-input" type="text" .value=${tg.apiRoot} placeholder="https://api.telegram.org"
            @change=${(e: Event) => this._field('telegram.apiRoot', (e.target as HTMLInputElement).value)} />
        </div>

        <div class="field-group">
          <div class="field-header"><label class="field-label">Proxy</label></div>
          <input class="text-input" type="text" .value=${tg.proxy} placeholder="http://proxy.example.com:8080"
            @change=${(e: Event) => this._field('telegram.proxy', (e.target as HTMLInputElement).value)} />
        </div>

        ${this._renderSelect('DM Policy', 'telegram.dmPolicy', tg.dmPolicy, dmOpts)}
        ${this._renderSelect('Group Policy', 'telegram.groupPolicy', tg.groupPolicy, groupOpts)}
        ${this._renderSelect('Reply To Mode', 'telegram.replyToMode', tg.replyToMode, replyOpts)}
        ${this._renderSelect('Stream Mode', 'telegram.streamMode', tg.streamMode, streamOpts)}

        <div class="field-group">
          <div class="field-header"><label class="field-label">Allow From Groups</label></div>
          <textarea class="textarea-input" rows="2" placeholder="-1001234567890"
            .value=${tg.groupAllowFrom.join(', ')}
            @change=${(e: Event) => this._field('telegram.groupAllowFrom',
              (e.target as HTMLTextAreaElement).value.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
            )}></textarea>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="field-group">
            <div class="field-header"><label class="field-label">History Limit</label></div>
            <input class="text-input" type="number" min="10" max="200" .value=${tg.historyLimit}
              @change=${(e: Event) => this._field('telegram.historyLimit', parseInt((e.target as HTMLInputElement).value) || 50)} />
          </div>
          <div class="field-group">
            <div class="field-header"><label class="field-label">Text Chunk Limit</label></div>
            <input class="text-input" type="number" min="1000" max="10000" step="100" .value=${tg.textChunkLimit}
              @change=${(e: Event) => this._field('telegram.textChunkLimit', parseInt((e.target as HTMLInputElement).value) || 4000)} />
          </div>
        </div>

        <div class="field-group">
          <label class="toggle-label">
            <input class="toggle-input" type="checkbox" .checked=${tg.debug}
              @change=${(e: Event) => this._field('telegram.debug', (e.target as HTMLInputElement).checked)} />
            <span class="toggle-switch"></span>
            <span class="toggle-text">Debug Mode</span>
          </label>
        </div>
      </div>
    `;
  }

  private _renderSelect<T extends string>(label: string, path: string, value: T, opts: { value: T; label: string }[]) {
    return html`
      <div class="field-group">
        <div class="field-header"><label class="field-label">${label}</label></div>
        <select class="select-input" .value=${String(value)}
          @change=${(e: Event) => this._field(path, (e.target as HTMLSelectElement).value)}>
          ${opts.map(o => html`<option value=${String(o.value)}>${o.label}</option>`)}
        </select>
      </div>
    `;
  }
}
