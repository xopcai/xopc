import { common } from '@kit.AbilityKit';

import { markdownLink } from '../common/markdown';
import { xopcConfirmDialog, xopcToast } from '../common/dialogActions';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { gatewaySession } from '../service/gatewaySession';

const ACTION_PATH: string = '/api/capabilities/mobile-actions';

interface NativeCapabilityResult<T> {
  ok: boolean;
  payload?: T;
  error?: string;
}

interface NativeSkillEntry {
  id: string;
  name: string;
  description: string;
  provider: string;
  author: string;
  security: string;
  installed: boolean;
  selection?: string;
}

interface NativeSkillResults {
  items: NativeSkillEntry[];
  incomplete: boolean;
}

interface NativeSkillInstall {
  installed: boolean;
  name: string;
}

interface NativeCapabilityCommand {
  action: string;
  expectedRevision?: number;
  server?: string;
  method?: string;
  authorization?: string;
  values?: Record<string, string | number | boolean>;
  url?: string;
}

interface NativeMcpDraft {
  id: string;
}

interface NativeMcpStatus {
  state?: string;
  serverId?: string;
  authorizationUrl?: string;
}

interface NativePluginField {
  id: string;
  title: string;
  type: string;
  sensitive?: boolean;
}

interface NativePluginMethod {
  id: string;
  title: string;
  type: string;
  fields: string[];
  instructions: string[];
}

interface NativePluginAccount {
  id: string;
  title: string;
  description?: string;
  methods: NativePluginMethod[];
}

interface NativePluginConnection {
  name: string;
  state: string;
}

interface NativePluginJob {
  revision: number;
  state: string;
  connections: NativePluginConnection[];
  missingConfig: string[];
}

interface NativePluginSetup {
  active: boolean;
  fields: NativePluginField[];
  accounts: NativePluginAccount[];
  job?: NativePluginJob;
  authorizationUrl?: string;
}

interface NativeAgentProfile {
  revision: number;
  name: string;
  description: string;
}

interface NativeAgentUpdate {
  expectedRevision: number;
  name: string;
  description: string;
}

async function capabilityRequest<T>(path: string, body?: string): Promise<T> {
  const revision = gatewaySession.connectionRevision();
  const raw = await gatewaySession.request(ACTION_PATH + path, body === undefined ? 'GET' : 'POST', body ?? '');
  gatewaySession.assertConnection(revision);
  const result = JSON.parse(raw) as NativeCapabilityResult<T>;
  if (!result.ok || result.payload === undefined) throw new Error(result.error ?? 'CAPABILITY_ACTION_FAILED');
  return result.payload;
}

@ComponentV2
export struct XopcCapabilitySetupView {
  @Param mode: string = 'skills';
  @Param itemId: string = '';
  @Param itemName: string = '';
  @Param initialQuery: string = '';
  @Param initialUrl: string = '';
  @Event onChanged: () => void = (): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local busy: boolean = false;
  @Local failed: boolean = false;
  @Local query: string = '';
  @Local searched: boolean = false;
  @Local skills: NativeSkillEntry[] = [];
  @Local incomplete: boolean = false;
  @Local installedItems: string[] = [];
  @Local mcpId: string = '';
  @Local mcpUrl: string = '';
  @Local draftId: string = '';
  @Local mcpState: string = '';
  @Local plugin?: NativePluginSetup;
  @Local agent?: NativeAgentProfile;
  @Local agentName: string = '';
  @Local agentDescription: string = '';
  @Local authorizationId: string = '';
  @Local pluginCallback: boolean = false;
  @Local redirectUrl: string = '';
  private readonly configValues: Map<string, string> = new Map<string, string>();
  private disposed: boolean = false;

  aboutToAppear(): void {
    if (this.mode === 'plugin') void this.loadPlugin();
    if (this.mode === 'agent') void this.loadAgent();
    if (this.mode === 'mcp') { this.mcpId = this.itemId; this.mcpUrl = this.initialUrl; }
    if (this.mode === 'skills' && this.initialQuery.trim().length > 1) {
      this.query = this.initialQuery; void this.search();
    }
  }

  private async loadAgent(): Promise<void> {
    this.busy = true;
    this.failed = false;
    try {
      const path = '/agent/' + encodeURIComponent(this.itemId);
      const profile = await capabilityRequest<NativeAgentProfile>(path);
      this.agent = profile;
      this.agentName = profile.name;
      this.agentDescription = profile.description;
    } catch (_) { this.failed = true; }
    finally { this.busy = false; }
  }

  private async saveAgent(): Promise<void> {
    if (!this.agent || this.busy || !this.agentName.trim()) return;
    this.busy = true;
    this.failed = false;
    try {
      const path = '/agent/' + encodeURIComponent(this.itemId);
      const update: NativeAgentUpdate = { expectedRevision: this.agent.revision, name: this.agentName,
        description: this.agentDescription };
      const profile = await capabilityRequest<NativeAgentProfile>(path, JSON.stringify(update));
      this.agent = profile;
      this.agentName = profile.name;
      this.agentDescription = profile.description;
      this.onChanged();
      xopcToast(this.getUIContext(), $r('app.string.cap_native_agent_saved'));
    } catch (_) { this.failed = true; }
    finally { this.busy = false; }
  }

  aboutToDisappear(): void {
    this.disposed = true;
    if (this.draftId && this.mcpState !== 'saved') {
      const body: NativeCapabilityCommand = { action: 'remove' };
      void capabilityRequest<NativeMcpStatus>('/mcp/' + this.draftId, JSON.stringify(body)).catch((): void => {});
    }
    this.configValues.clear();
  }

  private async openAuthorization(raw: string | undefined): Promise<void> {
    const link = raw && raw.startsWith('https://') ? markdownLink(raw) : '';
    if (!link) throw new Error('AUTHORIZATION_URL_UNAVAILABLE');
    await (this.getUIContext().getHostContext() as common.UIAbilityContext).openLink(link, { appLinkingOnly: false });
  }

  private async search(): Promise<void> {
    const query = this.query.trim();
    if (this.busy || query.length < 2) return;
    this.busy = true; this.failed = false;
    try {
      const result = await capabilityRequest<NativeSkillResults>('/skills?q=' + encodeURIComponent(query));
      this.skills = result.items; this.incomplete = result.incomplete; this.searched = true;
    } catch (_) { this.failed = true; }
    finally { this.busy = false; }
  }

  private async install(item: NativeSkillEntry): Promise<void> {
    if (this.busy || item.installed || !item.selection) return;
    this.busy = true; this.failed = false;
    try {
      const confirmed = await xopcConfirmDialog(this.getUIContext(), {
        title: item.name,
        message: $r('app.string.cap_native_skill_confirm'),
        confirmLabel: $r('app.string.cap_native_install'),
      });
      if (!confirmed) return;
      const saved = await capabilityRequest<NativeSkillInstall>('/skills', JSON.stringify({ selection: item.selection }));
      if (!saved.installed) throw new Error('SKILL_INSTALL_FAILED');
      this.installedItems = this.installedItems.concat(item.provider + ':' + item.id);
      this.onChanged();
    } catch (_) { this.failed = true; }
    finally { this.busy = false; }
  }

  private mcpRequest(action: string, url?: string): Promise<NativeMcpStatus> {
    const body: NativeCapabilityCommand = { action, url };
    return capabilityRequest<NativeMcpStatus>('/mcp/' + this.draftId, JSON.stringify(body));
  }

  private async runMcp(action: string): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.failed = false;
    try {
      if (action === 'probe') {
        if (!this.draftId) {
          const draft = await capabilityRequest<NativeMcpDraft>('/mcp',
            JSON.stringify({ serverId: this.mcpId.trim(), url: this.mcpUrl.trim() }));
          this.draftId = draft.id;
        }
        const result = await this.mcpRequest('probe');
        this.mcpState = result.state ?? '';
        this.failed = this.mcpState !== 'connected' && this.mcpState !== 'oauth_required';
      } else if (action === 'authorize') {
        let result = await this.mcpRequest('authorize');
        this.mcpState = 'authorizing';
        for (let count = 0; count < 15 && !result.authorizationUrl && !this.disposed; count++) {
          await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 450); });
          result = await this.mcpRequest('status');
          if (result.state === 'error') break;
        }
        if (!this.disposed) await this.openAuthorization(result.authorizationUrl);
      } else if (action === 'status') {
        const result = await this.mcpRequest('status');
        this.mcpState = result.state === 'connected' ? 'connected' : 'authorizing';
        this.failed = result.state === 'error';
      } else if (action === 'redirect') {
        await this.mcpRequest('redirect', this.redirectUrl.trim());
        this.redirectUrl = '';
      } else if (action === 'save') {
        const result = await this.mcpRequest('save');
        if (!result.serverId) throw new Error('MCP_SAVE_FAILED');
        this.mcpState = 'saved';
        this.onChanged();
      } else if (action === 'remove') {
        await this.mcpRequest('remove');
        this.draftId = ''; this.mcpState = ''; this.redirectUrl = '';
      }
    } catch (_) { this.failed = true; }
    finally { this.busy = false; }
  }

  private async loadPlugin(): Promise<void> {
    this.busy = true; this.failed = false;
    try { this.plugin = await capabilityRequest<NativePluginSetup>('/plugin/' + encodeURIComponent(this.itemId)); }
    catch (_) { this.failed = true; }
    finally { this.busy = false; }
  }

  private pluginRequest(body: NativeCapabilityCommand): Promise<NativePluginSetup> {
    return capabilityRequest<NativePluginSetup>('/plugin/' + encodeURIComponent(this.itemId), JSON.stringify(body));
  }

  private values(): Record<string, string | number | boolean> {
    const result: Record<string, string | number | boolean> = {};
    for (const field of this.plugin?.fields ?? []) {
      const input = this.configValues.get(field.id);
      if (input === undefined) continue;
      result[field.id] = field.type === 'boolean' ? input === 'true' : field.type === 'number' ? Number(input) : input;
    }
    return result;
  }

  private async runPlugin(action: string, account: string = '', method: string = '', callback: boolean = false): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.failed = false;
    try {
      const revision = this.plugin?.job?.revision;
      if (action === 'start') {
        this.plugin = await this.pluginRequest({ action });
      } else if (action === 'authorize') {
        this.authorizationId = account;
        this.pluginCallback = callback;
        this.plugin = await this.pluginRequest({ action, expectedRevision: revision, server: account, method: method || undefined });
        let result = await this.pluginRequest({ action: 'status', server: account });
        for (let count = 0; count < 12 && !result.authorizationUrl && !this.disposed; count++) {
          if (result.job?.connections.some((item: NativePluginConnection): boolean => item.name === account && item.state === 'connected')) break;
          await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 500); });
          result = await this.pluginRequest({ action: 'status', server: account });
        }
        this.plugin = result;
        if (result.authorizationUrl && !this.disposed) await this.openAuthorization(result.authorizationUrl);
      } else if (action === 'configure') {
        this.plugin = await this.pluginRequest({ action, expectedRevision: revision, values: this.values(),
          authorization: account || undefined, method: method || undefined });
        this.configValues.clear();
      } else if (action === 'redirect') {
        this.plugin = await this.pluginRequest({ action, server: this.authorizationId, url: this.redirectUrl.trim() });
        this.redirectUrl = '';
      } else {
        this.plugin = await this.pluginRequest({ action, expectedRevision: revision });
        if (action === 'complete') this.onChanged();
      }
    } catch (_) { this.failed = true; }
    finally { this.busy = false; }
  }

  @Builder
  private action(label: ResourceStr, accessibilityId: string, enabled: boolean, handler: () => void) {
    Button(label).id(accessibilityId).width('100%').height(48)
      .enabled(enabled && !this.busy).backgroundColor(this.colors.accent).fontColor(this.colors.onAccent)
      .borderRadius(this.colors.corner(15)).clipShape(this.colors.cornerClip(15)).onClick(handler)
  }

  @Builder
  private skillsPage() {
    TextInput({ text: this.query, placeholder: $r('app.string.cap_native_search') })
      .id('cap-native-skill-query').height(48).maxLength(160).enterKeyType(EnterKeyType.Search)
      .backgroundColor(this.colors.input).fontColor(this.colors.foreground)
      .onChange((value: string): void => { this.query = value; })
      .onSubmit((): void => { void this.search(); })
    Button($r('app.string.cap_native_search')).id('cap-native-skill-submit').width('100%').height(48)
      .enabled(!this.busy && this.query.trim().length >= 2).backgroundColor(this.colors.accent).fontColor(this.colors.onAccent)
      .borderRadius(this.colors.corner(15)).clipShape(this.colors.cornerClip(15)).onClick((): void => { void this.search(); })
    if (this.incomplete) Text($r('app.string.capability_partial')).fontSize(13).fontColor(this.colors.secondary)
    if (this.searched && !this.skills.length && !this.busy) Text($r('app.string.cap_native_skill_empty')).fontSize(15).fontColor(this.colors.secondary)
    ForEach(this.skills, (item: NativeSkillEntry) => {
      Column({ space: 8 }) {
        Text(item.name).fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
        Text(item.description).fontSize(13).fontColor(this.colors.secondary).maxLines(3)
        Text(item.author ? item.provider + ' · ' + item.author : item.provider).fontSize(12).fontColor(this.colors.secondary)
        if (item.installed || this.installedItems.includes(item.provider + ':' + item.id)) {
          Text($r('app.string.cap_native_installed')).fontSize(13).fontColor(this.colors.success)
        } else if (!item.selection) {
          Text($r('app.string.cap_native_unavailable')).fontSize(13).fontColor(this.colors.secondary)
        } else {
          Button($r('app.string.cap_native_install')).id('cap-native-skill-install-' + item.id).height(44).enabled(!this.busy)
            .backgroundColor(this.colors.accentSoft).fontColor(this.colors.chat.action)
            .onClick((): void => { void this.install(item); })
        }
      }.id('cap-native-skill-result-' + item.id).width('100%').alignItems(HorizontalAlign.Start).padding(14)
        .backgroundColor(this.colors.grouped).borderRadius(this.colors.corner(15))
    }, (item: NativeSkillEntry): string => item.provider + ':' + item.id)
  }

  @Builder
  private agentPage() {
    if (this.agent) {
      Text($r('app.string.cap_native_agent_name')).fontSize(14).fontColor(this.colors.secondary)
      TextInput({ text: this.agentName }).id('cap-native-agent-name').height(48).maxLength(100)
        .backgroundColor(this.colors.input).fontColor(this.colors.foreground)
        .onChange((value: string): void => { this.agentName = value; })
      Text($r('app.string.cap_native_agent_description')).fontSize(14).fontColor(this.colors.secondary)
      TextArea({ text: this.agentDescription }).id('cap-native-agent-description').height(108).maxLength(2000)
        .backgroundColor(this.colors.input).fontColor(this.colors.foreground)
        .onChange((value: string): void => { this.agentDescription = value; })
      Button($r('app.string.cap_native_agent_save')).id('cap-native-agent-save').height(48).width('100%')
        .enabled(!this.busy && !!this.agentName.trim() && (this.agentName.trim() !== this.agent.name ||
          this.agentDescription.trim() !== this.agent.description))
        .backgroundColor(this.colors.accent).fontColor(this.colors.onAccent).borderRadius(this.colors.corner(15)).clipShape(this.colors.cornerClip(15))
        .onClick((): void => {
          this.getUIContext().getFocusController().clearFocus();
          void this.saveAgent();
        })
    } else if (this.failed) {
      this.action($r('app.string.capability_retry'), 'cap-native-agent-retry', true, (): void => { void this.loadAgent(); })
    }
  }

  @Builder
  private mcpPage() {
    TextInput({ text: this.mcpId, placeholder: $r('app.string.cap_native_mcp_id') })
      .id('cap-native-mcp-id').height(48).maxLength(64).enabled(!this.draftId)
      .backgroundColor(this.colors.input).fontColor(this.colors.foreground)
      .onChange((value: string): void => { this.mcpId = value; })
    TextInput({ text: this.mcpUrl, placeholder: $r('app.string.cap_native_mcp_url') })
      .id('cap-native-mcp-url').height(48).maxLength(2048).enabled(!this.draftId)
      .backgroundColor(this.colors.input).fontColor(this.colors.foreground)
      .onChange((value: string): void => { this.mcpUrl = value; })
    if (this.mcpState === 'saved') {
      Text($r('app.string.cap_native_saved')).fontColor(this.colors.success).id('cap-native-mcp-saved')
    } else if (this.mcpState === 'connected') {
      Text($r('app.string.cap_native_connected')).fontColor(this.colors.success).id('cap-native-mcp-connected')
      this.action($r('app.string.cap_native_save'), 'cap-native-mcp-save', true, (): void => { void this.runMcp('save'); })
    } else if (this.mcpState === 'oauth_required') {
      Text($r('app.string.cap_native_oauth_required')).fontColor(this.colors.secondary)
      this.action($r('app.string.cap_native_authorize'), 'cap-native-mcp-authorize', true, (): void => { void this.runMcp('authorize'); })
    } else if (this.mcpState === 'authorizing') {
      Text($r('app.string.cap_native_waiting')).fontColor(this.colors.secondary)
      this.action($r('app.string.cap_native_check'), 'cap-native-mcp-check', true, (): void => { void this.runMcp('status'); })
      this.callbackField((): void => { void this.runMcp('redirect'); })
    } else {
      Button($r('app.string.cap_native_test')).id('cap-native-mcp-test').width('100%').height(48)
        .enabled(!this.busy && !!this.mcpId.trim() && !!this.mcpUrl.trim()).backgroundColor(this.colors.accent)
        .fontColor(this.colors.onAccent).borderRadius(this.colors.corner(15)).clipShape(this.colors.cornerClip(15)).onClick((): void => { void this.runMcp('probe'); })
    }
    if (this.draftId && this.mcpState !== 'saved') {
      Button($r('app.string.cap_native_edit_mcp')).id('cap-native-mcp-edit').height(44).width('100%').enabled(!this.busy)
        .backgroundColor(this.colors.grouped).fontColor(this.colors.foreground)
        .onClick((): void => { void this.runMcp('remove'); })
    }
  }

  @Builder
  private callbackField(onSubmit: () => void) {
    Text($r('app.string.cap_native_mcp_callback_hint')).fontSize(13).fontColor(this.colors.secondary)
    TextInput({ text: this.redirectUrl, placeholder: $r('app.string.cap_native_redirect') })
      .height(48).maxLength(8192).type(InputType.Password).backgroundColor(this.colors.input).fontColor(this.colors.foreground)
      .onChange((value: string): void => { this.redirectUrl = value; })
    Button($r('app.string.cap_native_submit_redirect')).id('cap-native-redirect').width('100%').height(48)
      .enabled(!this.busy && !!this.redirectUrl.trim()).backgroundColor(this.colors.accent).fontColor(this.colors.onAccent)
      .borderRadius(this.colors.corner(15)).clipShape(this.colors.cornerClip(15)).onClick(onSubmit)
  }

  @Builder
  private pluginPage() {
    if (this.plugin?.active) Text($r('app.string.cap_native_plugin_ready')).fontSize(14).fontColor(this.colors.secondary)
    if (this.plugin && !this.plugin.job) {
      this.action($r('app.string.cap_native_setup_start'), 'cap-native-plugin-start', true, (): void => { void this.runPlugin('start'); })
    }
    if (this.plugin?.job) {
      if (this.plugin.job.state === 'completed') Text($r('app.string.cap_native_ready')).fontColor(this.colors.success)
      if (this.plugin.job.state === 'pending' || this.plugin.job.state === 'interrupted' || this.plugin.job.state === 'failed') {
        this.action($r('app.string.cap_native_prepare'), 'cap-native-plugin-prepare', true, (): void => { void this.runPlugin('prepare'); })
      }
      if (this.plugin.job.state === 'running') Text($r('app.string.cap_native_preparing')).fontColor(this.colors.secondary)
      ForEach(this.plugin.fields, (field: NativePluginField) => {
        Text(field.title).fontSize(14).fontColor(this.colors.foreground)
        TextInput({ placeholder: field.title }).id('cap-native-plugin-field-' + field.id).height(48).maxLength(2048)
          .type(field.sensitive ? InputType.Password : InputType.Normal)
          .backgroundColor(this.colors.input).fontColor(this.colors.foreground)
          .onChange((value: string): void => { this.configValues.set(field.id, value); })
      }, (field: NativePluginField): string => field.id)
      if (this.plugin.fields.length) {
        this.action($r('app.string.cap_native_configure'), 'cap-native-plugin-save-config', true,
          (): void => { void this.runPlugin('configure'); })
      }
      ForEach(this.plugin.accounts, (account: NativePluginAccount) => {
        Text(account.title).fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
        if (account.description) Text(account.description).fontSize(14).fontColor(this.colors.secondary)
        ForEach(account.methods, (method: NativePluginMethod) => {
          if (method.instructions.length) Text(method.instructions.join('\n')).fontSize(13).fontColor(this.colors.secondary)
          this.action(method.title,
            'cap-native-plugin-auth-' + account.id + '-' + method.id, this.plugin?.job?.state !== 'running',
            (): void => { void this.runPlugin(method.type === 'form' ? 'configure' : 'authorize', account.id, method.id, method.type === 'oauth'); })
        }, (method: NativePluginMethod): string => method.id)
      }, (account: NativePluginAccount): string => account.id)
      if (!this.plugin.accounts.length) ForEach(this.plugin.job.connections, (connection: NativePluginConnection) => {
        Text(connection.name).fontSize(14).fontColor(this.colors.foreground)
        if (connection.state === 'oauth_required') {
          this.action($r('app.string.cap_native_authorize'), 'cap-native-plugin-auth-' + connection.name, true,
            (): void => { void this.runPlugin('authorize', connection.name, '', true); })
        }
      }, (connection: NativePluginConnection): string => connection.name)
      if (this.authorizationId && this.pluginCallback) this.callbackField((): void => { void this.runPlugin('redirect'); })
      this.action($r('app.string.cap_native_check'), 'cap-native-plugin-check', true, (): void => { void this.loadPlugin(); })
      if (this.plugin.job.state === 'action_required' && !this.plugin.job.missingConfig.length) {
        this.action($r('app.string.cap_native_complete'), 'cap-native-plugin-complete', true, (): void => { void this.runPlugin('complete'); })
      }
    }
  }

  build() {
    Scroll() {
      Column({ space: 12 }) {
        Text(this.mode === 'mcp' ? $r('app.string.cap_native_mcp') : this.mode === 'plugin' ? this.itemName
          : this.mode === 'agent' ? $r('app.string.cap_native_edit_agent') : $r('app.string.cap_native_skill'))
          .fontSize(22).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
        if (this.mode === 'skills') this.skillsPage()
        else if (this.mode === 'mcp') this.mcpPage()
        else if (this.mode === 'agent') this.agentPage()
        else this.pluginPage()
        if (this.busy) LoadingProgress().width(24).height(24).color(this.colors.accent)
        if (this.failed) Text($r('app.string.cap_native_failed')).fontSize(14).fontColor(this.colors.danger).id('cap-native-error')
      }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 24, right: 24, top: 24, bottom: 32 })
    }.width('100%').edgeEffect(EdgeEffect.None).scrollBar(BarState.Off).align(Alignment.Top)
  }
}
