import { html, LitElement } from 'lit';
import type { PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons.js';
import { t } from '../utils/i18n.js';
import type { SettingsData, DmPolicy, GroupPolicy, ReplyToMode, StreamMode, TelegramAccount, WeixinAccount } from './types.js';

@customElement('channels-section')
export class ChannelsSection extends LitElement {
  @property({ attribute: false }) settings!: SettingsData;
  @property({ attribute: false }) onChange!: (path: string, value: unknown) => void;

  // Token visibility state (local, not @state to avoid full re-render)
  private _showToken = false;
  private _copied = false;

  /** Draft for `channels.telegram.accounts` JSON (synced when server-side accounts change) */
  private _accountsDraft = '';
  private _accountsParseError = '';

  private _weixinAccountsDraft = '';
  private _weixinAccountsParseError = '';

  /** Section body visible when channel is enabled (user can still collapse while enabled). */
  @state() private _telegramExpanded = true;
  @state() private _weixinExpanded = true;

  createRenderRoot() { return this; }

  override willUpdate(changedProperties: PropertyValues) {
    super.willUpdate(changedProperties);
    if (changedProperties.has('settings')) {
      const prev = changedProperties.get('settings') as SettingsData | undefined;
      if (prev && !prev.telegram.enabled && this.settings.telegram.enabled) {
        this._telegramExpanded = true;
      }
      if (prev && !prev.weixin.enabled && this.settings.weixin.enabled) {
        this._weixinExpanded = true;
      }
      const prevAcc = JSON.stringify(prev?.telegram?.accounts ?? {});
      const nextAcc = JSON.stringify(this.settings.telegram.accounts ?? {});
      if (prev === undefined || prevAcc !== nextAcc) {
        this._accountsDraft = JSON.stringify(this.settings.telegram.accounts ?? {}, null, 2);
        this._accountsParseError = '';
      }
      const prevWx = JSON.stringify(prev?.weixin?.accounts ?? {});
      const nextWx = JSON.stringify(this.settings.weixin?.accounts ?? {});
      if (prev === undefined || prevWx !== nextWx) {
        this._weixinAccountsDraft = JSON.stringify(this.settings.weixin?.accounts ?? {}, null, 2);
        this._weixinAccountsParseError = '';
      }
    }
  }

  private _field(path: string, value: unknown) { this.onChange(path, value); }

  private _onAccountsJsonBlur(e: Event) {
    const raw = (e.target as HTMLTextAreaElement).value.trim();
    if (!raw) {
      this._field('telegram.accounts', {});
      this._accountsParseError = '';
      this.requestUpdate();
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Accounts must be a JSON object');
      }
      this._field('telegram.accounts', parsed as Record<string, TelegramAccount>);
      this._accountsParseError = '';
    } catch (err) {
      this._accountsParseError = err instanceof Error ? err.message : 'Invalid JSON';
    }
    this.requestUpdate();
  }

  private _onWeixinAccountsJsonBlur(e: Event) {
    const raw = (e.target as HTMLTextAreaElement).value.trim();
    if (!raw) {
      this._field('weixin.accounts', {});
      this._weixinAccountsParseError = '';
      this.requestUpdate();
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Accounts must be a JSON object');
      }
      this._field('weixin.accounts', parsed as Record<string, WeixinAccount>);
      this._weixinAccountsParseError = '';
    } catch (err) {
      this._weixinAccountsParseError = err instanceof Error ? err.message : 'Invalid JSON';
    }
    this.requestUpdate();
  }

  private _toggleToken() { this._showToken = !this._showToken; this.requestUpdate(); }

  private async _copyToken() {
    const botToken = this.settings.telegram.botToken;
    if (!botToken) return;
    await navigator.clipboard.writeText(botToken).catch(() => {});
    this._copied = true;
    this.requestUpdate();
    setTimeout(() => { this._copied = false; this.requestUpdate(); }, 2000);
  }

  private _onTelegramEnabledChange(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    if (checked) this._telegramExpanded = true;
    this._field('telegram.enabled', checked);
  }

  private _onWeixinEnabledChange(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    if (checked) this._weixinExpanded = true;
    this._field('weixin.enabled', checked);
  }

  private _toggleTelegramSection() {
    if (!this.settings.telegram.enabled) return;
    this._telegramExpanded = !this._telegramExpanded;
  }

  private _toggleWeixinSection() {
    if (!this.settings.weixin.enabled) return;
    this._weixinExpanded = !this._weixinExpanded;
  }

  private _onTelegramHeaderClick(e: Event) {
    if ((e.target as HTMLElement).closest('.channel-card__toggle')) return;
    this._toggleTelegramSection();
  }

  private _onWeixinHeaderClick(e: Event) {
    if ((e.target as HTMLElement).closest('.channel-card__toggle')) return;
    this._toggleWeixinSection();
  }

  private _onTelegramHeaderKeydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('.channel-card__toggle')) return;
    if (!this.settings.telegram.enabled) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    this._toggleTelegramSection();
  }

  private _onWeixinHeaderKeydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('.channel-card__toggle')) return;
    if (!this.settings.weixin.enabled) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    this._toggleWeixinSection();
  }

  override render() {
    return html`
      <div class="section-content">
        <div class="section-header">
          <h2>${t('settings.sections.channels')}</h2>
          <p class="section-desc">${t('settings.descriptions.channels')}</p>
        </div>
        <div class="channels-layout">
          ${this._renderTelegram()}
          ${this._renderWeixin()}
        </div>
      </div>
    `;
  }

  private _renderTelegram() {
    const tg = this.settings.telegram;
    const showBody = tg.enabled && this._telegramExpanded;
    return html`
      <article class="channel-card ${tg.enabled && !this._telegramExpanded ? 'channel-card--collapsed' : ''}" aria-labelledby="channel-telegram-title">
        <header
          class="channel-card__header ${tg.enabled ? 'channel-card__header--interactive' : ''}"
          tabindex=${tg.enabled ? 0 : -1}
          aria-controls="channel-telegram-body"
          aria-expanded=${tg.enabled ? String(this._telegramExpanded) : 'false'}
          aria-label=${tg.enabled
            ? (this._telegramExpanded ? t('settings.channelsUi.collapseDetails') : t('settings.channelsUi.expandDetails'))
            : undefined}
          @click=${this._onTelegramHeaderClick}
          @keydown=${this._onTelegramHeaderKeydown}
        >
          <div class="channel-card__headline">
            <span class="channel-card__icon" aria-hidden="true">${getIcon('send')}</span>
            <div class="channel-card__titles">
              <h3 class="channel-card__title" id="channel-telegram-title">${t('settings.fields.telegramEnabled')}</h3>
              <p class="channel-card__subtitle">${t('settings.channelsUi.telegramCardSubtitle')}</p>
            </div>
          </div>
          <label class="toggle-label toggle-label--compact channel-card__toggle" @click=${(e: Event) => e.stopPropagation()}>
            <input class="toggle-input" type="checkbox" .checked=${tg.enabled}
              aria-label="${t('settings.descriptionsFields.telegramEnabled')}"
              @change=${this._onTelegramEnabledChange} />
            <span class="toggle-switch"></span>
          </label>
        </header>

        ${showBody ? html`
          <div class="channel-card__body" id="channel-telegram-body">
            <div class="channel-card__stack">

            <div class="field-group">
              <div class="field-header"><label class="field-label">${t('settings.fields.telegramToken')} <span class="required-mark">*</span></label></div>
              <div class="input-with-actions">
                <input class="text-input" type="${this._showToken ? 'text' : 'password'}" .value=${tg.botToken}
                  placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                  @change=${(e: Event) => this._field('telegram.botToken', (e.target as HTMLInputElement).value)} />
                <div class="input-actions">
                  ${tg.botToken ? html`<button class="btn-icon" @click=${this._copyToken} title="${this._copied ? 'Copied!' : 'Copy'}">${getIcon(this._copied ? 'check' : 'copy')}</button>` : ''}
                  <button class="btn-icon" @click=${this._toggleToken} title="${this._showToken ? 'Hide' : 'Show'}">${getIcon(this._showToken ? 'eyeOff' : 'eye')}</button>
                </div>
              </div>
              <p class="field-desc">${t('settings.descriptionsFields.telegramToken')}</p>
            </div>

            <div class="field-group">
              <div class="field-header"><label class="field-label">${t('settings.fields.telegramAllowFrom')}</label></div>
              <textarea class="textarea-input" rows="1" placeholder="123456789, 987654321"
                .value=${tg.allowFrom.join(', ')}
                @change=${(e: Event) => this._field('telegram.allowFrom',
                  (e.target as HTMLTextAreaElement).value.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
                )}></textarea>
              <p class="field-desc">${t('settings.descriptionsFields.telegramAllowFrom')}</p>
            </div>

            <div class="field-group">
              <button type="button" class="btn btn-ghost"
                @click=${() => this._field('telegram.advancedMode', !tg.advancedMode)}>
                ${getIcon(tg.advancedMode ? 'chevronUp' : 'chevronDown')}
                <span>${tg.advancedMode ? t('settings.channelsUi.advancedHide') : t('settings.channelsUi.advancedShow')}</span>
              </button>
            </div>

            ${tg.advancedMode ? this._renderAdvanced() : ''}
            </div>
          </div>
        ` : ''}
      </article>
    `;
  }

  private _renderWeixin() {
    const wx = this.settings.weixin;
    const showBody = wx.enabled && this._weixinExpanded;
    return html`
      <article class="channel-card ${wx.enabled && !this._weixinExpanded ? 'channel-card--collapsed' : ''}" aria-labelledby="channel-weixin-title">
        <header
          class="channel-card__header ${wx.enabled ? 'channel-card__header--interactive' : ''}"
          tabindex=${wx.enabled ? 0 : -1}
          aria-controls="channel-weixin-body"
          aria-expanded=${wx.enabled ? String(this._weixinExpanded) : 'false'}
          aria-label=${wx.enabled
            ? (this._weixinExpanded ? t('settings.channelsUi.collapseDetails') : t('settings.channelsUi.expandDetails'))
            : undefined}
          @click=${this._onWeixinHeaderClick}
          @keydown=${this._onWeixinHeaderKeydown}
        >
          <div class="channel-card__headline">
            <span class="channel-card__icon" aria-hidden="true">${getIcon('messageSquare')}</span>
            <div class="channel-card__titles">
              <h3 class="channel-card__title" id="channel-weixin-title">${t('settings.fields.weixinEnabled')}</h3>
              <p class="channel-card__subtitle">${t('settings.channelsUi.weixinCardSubtitle')}</p>
            </div>
          </div>
          <label class="toggle-label toggle-label--compact channel-card__toggle" @click=${(e: Event) => e.stopPropagation()}>
            <input class="toggle-input" type="checkbox" .checked=${wx.enabled}
              aria-label="${t('settings.descriptionsFields.weixinEnabled')}"
              @change=${this._onWeixinEnabledChange} />
            <span class="toggle-switch"></span>
          </label>
        </header>

        ${showBody ? html`
          <div class="channel-card__body" id="channel-weixin-body">
            <div class="channel-card__stack">
            <p class="field-desc field-desc--callout">${t('settings.descriptionsFields.weixinLogin')}</p>

            <div class="field-group">
              <div class="field-header"><label class="field-label">${t('settings.fields.weixinAllowFrom')}</label></div>
              <textarea class="textarea-input" rows="1" placeholder="wxid_..., openid_..."
                .value=${wx.allowFrom.join(', ')}
                @change=${(e: Event) => this._field('weixin.allowFrom',
                  (e.target as HTMLTextAreaElement).value.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
                )}></textarea>
              <p class="field-desc">${t('settings.descriptionsFields.weixinAllowFrom')}</p>
            </div>

            <div class="field-group">
              <button type="button" class="btn btn-ghost"
                @click=${() => this._field('weixin.advancedMode', !wx.advancedMode)}>
                ${getIcon(wx.advancedMode ? 'chevronUp' : 'chevronDown')}
                <span>${wx.advancedMode ? t('settings.channelsUi.advancedHide') : t('settings.channelsUi.advancedShow')}</span>
              </button>
            </div>

            ${wx.advancedMode ? this._renderWeixinAdvanced() : ''}
            </div>
          </div>
        ` : ''}
      </article>
    `;
  }

  private _renderWeixinAdvanced() {
    const wx = this.settings.weixin;
    const dmOpts: { value: DmPolicy; label: string }[] = [
      { value: 'pairing', label: 'Pairing' }, { value: 'allowlist', label: 'Allowlist' },
      { value: 'open', label: 'Open' }, { value: 'disabled', label: 'Disabled' },
    ];
    const streamOpts: { value: StreamMode; label: string }[] = [
      { value: 'off', label: 'Off' }, { value: 'partial', label: 'Partial' }, { value: 'block', label: 'Block' },
    ];

    return html`
      <div class="channel-card__advanced">
        ${this._renderSelect('DM Policy', 'weixin.dmPolicy', wx.dmPolicy, dmOpts)}
        ${this._renderSelect('Stream Mode', 'weixin.streamMode', wx.streamMode, streamOpts)}

        <div class="settings-field-row">
          <div class="field-group">
            <div class="field-header"><label class="field-label">${t('settings.fields.weixinHistoryLimit')}</label></div>
            <input class="text-input" type="number" min="10" max="200" .value=${wx.historyLimit}
              @change=${(e: Event) => this._field('weixin.historyLimit', parseInt((e.target as HTMLInputElement).value) || 50)} />
          </div>
          <div class="field-group">
            <div class="field-header"><label class="field-label">${t('settings.fields.weixinTextChunkLimit')}</label></div>
            <input class="text-input" type="number" min="1000" max="10000" step="100" .value=${wx.textChunkLimit}
              @change=${(e: Event) => this._field('weixin.textChunkLimit', parseInt((e.target as HTMLInputElement).value) || 4000)} />
          </div>
        </div>

        <div class="field-group">
          <div class="field-header"><label class="field-label">${t('settings.fields.weixinRouteTag')}</label></div>
          <input class="text-input" type="text" .value=${wx.routeTag}
            placeholder="${t('settings.placeholders.weixinRouteTag')}"
            @change=${(e: Event) => this._field('weixin.routeTag', (e.target as HTMLInputElement).value)} />
          <p class="field-desc">${t('settings.descriptionsFields.weixinRouteTag')}</p>
        </div>

        <div class="field-group">
          <label class="toggle-label">
            <input class="toggle-input" type="checkbox" .checked=${wx.debug}
              @change=${(e: Event) => this._field('weixin.debug', (e.target as HTMLInputElement).checked)} />
            <span class="toggle-switch"></span>
            <span class="toggle-text">${t('settings.fields.weixinDebug')}</span>
          </label>
          <p class="field-desc">${t('settings.descriptionsFields.weixinDebug')}</p>
        </div>

        <div class="field-group">
          <div class="field-header"><label class="field-label">${t('settings.fields.weixinAccountsJson')}</label></div>
          <textarea class="textarea-input textarea-input--code" rows="6"
            .value=${this._weixinAccountsDraft}
            @input=${(e: Event) => { this._weixinAccountsDraft = (e.target as HTMLTextAreaElement).value; }}
            @blur=${this._onWeixinAccountsJsonBlur}
            placeholder='{ "personal": { "name": "...", "cdnBaseUrl": "...", "enabled": true } }'></textarea>
          ${this._weixinAccountsParseError
            ? html`<p class="field-desc field-desc--error">${this._weixinAccountsParseError}</p>`
            : html`<p class="field-desc">${t('settings.descriptionsFields.weixinAccountsJson')}</p>`}
        </div>
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
      <div class="channel-card__advanced">

        <div class="field-group">
          <div class="field-header"><label class="field-label">${t('settings.fields.telegramApiRoot')}</label></div>
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
          <textarea class="textarea-input" rows="1" placeholder="-1001234567890"
            .value=${tg.groupAllowFrom.join(', ')}
            @change=${(e: Event) => this._field('telegram.groupAllowFrom',
              (e.target as HTMLTextAreaElement).value.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
            )}></textarea>
        </div>

        <div class="settings-field-row">
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

        <div class="field-group">
          <div class="field-header"><label class="field-label">Multi-account (JSON)</label></div>
          <textarea class="textarea-input textarea-input--code" rows="6"
            .value=${this._accountsDraft}
            @input=${(e: Event) => { this._accountsDraft = (e.target as HTMLTextAreaElement).value; }}
            @blur=${this._onAccountsJsonBlur}
            placeholder='{ "personal": { "accountId": "personal", "botToken": "...", ... } }'></textarea>
          ${this._accountsParseError
            ? html`<p class="field-desc field-desc--error">${this._accountsParseError}</p>`
            : html`<p class="field-desc">Optional. When set, each account can use <code>botToken</code> or <code>tokenFile</code>, plus per-account policies and <code>groups</code>. Empty <code>{}</code> uses the single bot token above only.</p>`}
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
