import type {
  ActivationDeclaration,
  ChatWidgetContribution,
  ChatWidgetMatch,
  CommandContribution,
  ContractDeclaration,
  EnginesDeclaration,
  ExtensionManifest,
  ExtensionManifestCommand,
  ExtensionUiContributions,
  ExtensionUiManifest,
  ExtensionUiPermission,
  ModelSupportDeclaration,
  PageContribution,
  ProviderAuthChoice,
  SettingsPanelContribution,
  SetupDeclaration,
  SidebarPanelContribution,
  StatusBarItemContribution,
} from './types/manifest.js';
import type { ExtensionKind } from './types/core.js';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function normalizeReload(raw: unknown): ExtensionManifest['reload'] {
  if (!isRecord(raw)) return undefined;
  const configPrefixes = Array.isArray(raw.configPrefixes)
    ? raw.configPrefixes.filter((x): x is string => typeof x === 'string')
    : undefined;
  const supportsHotReload =
    typeof raw.supportsHotReload === 'boolean' ? raw.supportsHotReload : undefined;
  if (!configPrefixes?.length && supportsHotReload === undefined) return undefined;
  return {
    ...(configPrefixes?.length ? { configPrefixes } : {}),
    ...(supportsHotReload !== undefined ? { supportsHotReload } : {}),
  };
}

function normalizeEngines(raw: unknown): EnginesDeclaration | undefined {
  if (!isRecord(raw)) return undefined;
  const xopc = typeof raw.xopc === 'string' && raw.xopc.length > 0 ? raw.xopc : undefined;
  if (!xopc) return undefined;
  return { xopc };
}

function normalizeManifestCommands(raw: unknown): ExtensionManifestCommand[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ExtensionManifestCommand[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const description = typeof item.description === 'string' ? item.description : '';
    if (!name || !description) continue;
    const aliases = Array.isArray(item.aliases)
      ? item.aliases.filter((x): x is string => typeof x === 'string')
      : undefined;
    const scope = Array.isArray(item.scope)
      ? item.scope.filter(
          (x): x is 'global' | 'private' | 'group' =>
            x === 'global' || x === 'private' || x === 'group',
        )
      : undefined;
    const examples = Array.isArray(item.examples)
      ? item.examples.filter((x): x is string => typeof x === 'string')
      : undefined;
    out.push({
      name,
      description,
      ...(aliases?.length ? { aliases } : {}),
      ...(scope?.length ? { scope } : {}),
      ...(examples?.length ? { examples } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Normalize raw JSON manifest into ExtensionManifest with stable optional fields.
 */
export function normalizeExtensionManifest(raw: Record<string, unknown>): ExtensionManifest {
  const id = String(raw.id ?? '');
  return {
    id,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : id,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    kind: raw.kind as ExtensionKind | undefined,
    main: typeof raw.main === 'string' ? raw.main : undefined,
    configSchema: isRecord(raw.configSchema) ? (raw.configSchema as Record<string, unknown>) : undefined,
    dependencies: isRecord(raw.dependencies) ? (raw.dependencies as Record<string, string>) : undefined,

    enabledByDefault: typeof raw.enabledByDefault === 'boolean' ? raw.enabledByDefault : undefined,
    legacyExtensionIds: Array.isArray(raw.legacyExtensionIds)
      ? raw.legacyExtensionIds.filter((x): x is string => typeof x === 'string')
      : undefined,

    providers: Array.isArray(raw.providers)
      ? raw.providers.filter((x): x is string => typeof x === 'string')
      : undefined,
    speechProviders: Array.isArray(raw.speechProviders)
      ? raw.speechProviders.filter((x): x is string => typeof x === 'string')
      : undefined,
    mediaUnderstandingProviders: Array.isArray(raw.mediaUnderstandingProviders)
      ? raw.mediaUnderstandingProviders.filter((x): x is string => typeof x === 'string')
      : undefined,
    providerAuthEnvVars: normalizeStringArrayMap(raw.providerAuthEnvVars),
    providerAuthChoices: normalizeProviderAuthChoices(raw.providerAuthChoices),
    modelSupport: normalizeModelSupport(raw.modelSupport),
    autoEnableWhenConfiguredProviders: Array.isArray(raw.autoEnableWhenConfiguredProviders)
      ? raw.autoEnableWhenConfiguredProviders.filter((x): x is string => typeof x === 'string')
      : undefined,

    channels: Array.isArray(raw.channels)
      ? raw.channels.filter((x): x is string => typeof x === 'string')
      : undefined,
    channelEnvVars: normalizeStringArrayMap(raw.channelEnvVars),

    activation: normalizeActivation(raw.activation),
    contracts: normalizeContracts(raw.contracts),
    setup: normalizeSetup(raw.setup),
    reload: normalizeReload(raw.reload),
    engines: normalizeEngines(raw.engines),
    commands: normalizeManifestCommands(raw.commands),
    ui: normalizeUiManifest(raw.ui),
  };
}

const VALID_UI_PERMISSIONS = new Set<ExtensionUiPermission>([
  'agent.send',
  'agent.subscribe',
  'session.read',
  'session.write',
  'config.read',
  'config.write',
  'storage',
  'notification',
  'clipboard',
  'theme',
  'workspace.read',
  'workspace.write',
]);

export function normalizeUiManifest(raw: unknown): ExtensionUiManifest | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) return undefined;
  const main = typeof raw.main === 'string' && raw.main.length > 0 ? raw.main : undefined;
  const icon = typeof raw.icon === 'string' && raw.icon.length > 0 ? raw.icon : undefined;
  let permissions: ExtensionUiPermission[] | undefined;
  if (Array.isArray(raw.permissions)) {
    const p = raw.permissions.filter(
      (x): x is ExtensionUiPermission =>
        typeof x === 'string' && VALID_UI_PERMISSIONS.has(x as ExtensionUiPermission),
    );
    permissions = p.length ? p : undefined;
  }
  const contributions = normalizeUiContributions(raw.contributions);
  if (!main && !icon && !permissions && !contributions) return undefined;
  return {
    ...(main !== undefined ? { main } : {}),
    ...(icon !== undefined ? { icon } : {}),
    ...(permissions !== undefined ? { permissions } : {}),
    ...(contributions !== undefined ? { contributions } : {}),
  };
}

function normalizeUiContributions(raw: unknown): ExtensionUiContributions | undefined {
  if (!isRecord(raw)) return undefined;
  const sidebarPanels = normalizeSidebarPanels(raw.sidebarPanels);
  const settingsPanels = normalizeSettingsPanels(raw.settingsPanels);
  const chatWidgets = normalizeChatWidgets(raw.chatWidgets);
  const pages = normalizePages(raw.pages);
  const commands = normalizeCommands(raw.commands);
  const statusBarItems = normalizeStatusBarItems(raw.statusBarItems);
  const out: ExtensionUiContributions = {
    ...(sidebarPanels ? { sidebarPanels } : {}),
    ...(settingsPanels ? { settingsPanels } : {}),
    ...(chatWidgets ? { chatWidgets } : {}),
    ...(pages ? { pages } : {}),
    ...(commands ? { commands } : {}),
    ...(statusBarItems ? { statusBarItems } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

function normalizeSidebarPanels(raw: unknown): SidebarPanelContribution[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SidebarPanelContribution[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = item.id;
    const title = item.title;
    const entrypoint = item.entrypoint;
    if (typeof id !== 'string' || typeof title !== 'string' || typeof entrypoint !== 'string') {
      continue;
    }
    out.push({
      id,
      title,
      entrypoint,
      icon: typeof item.icon === 'string' ? item.icon : undefined,
      defaultVisible: typeof item.defaultVisible === 'boolean' ? item.defaultVisible : undefined,
      when: typeof item.when === 'string' && item.when.length > 0 ? item.when : undefined,
    });
  }
  return out.length ? out : undefined;
}

function normalizeSettingsPanels(raw: unknown): SettingsPanelContribution[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SettingsPanelContribution[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = item.id;
    const title = item.title;
    const entrypoint = item.entrypoint;
    if (typeof id !== 'string' || typeof title !== 'string' || typeof entrypoint !== 'string') {
      continue;
    }
    out.push({
      id,
      title,
      entrypoint,
      order: typeof item.order === 'number' ? item.order : undefined,
    });
  }
  return out.length ? out : undefined;
}

function normalizeChatWidgetMatch(raw: unknown): ChatWidgetMatch | undefined {
  if (!isRecord(raw)) return undefined;
  const toolName = typeof raw.toolName === 'string' ? raw.toolName : undefined;
  const contentType = typeof raw.contentType === 'string' ? raw.contentType : undefined;
  let metadata: Record<string, unknown> | undefined;
  if (isRecord(raw.metadata)) {
    metadata = { ...raw.metadata };
  }
  if (!toolName && !contentType && !metadata) return undefined;
  return { toolName, contentType, metadata };
}

function normalizeChatWidgets(raw: unknown): ChatWidgetContribution[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ChatWidgetContribution[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = item.id;
    const title = item.title;
    const entrypoint = item.entrypoint;
    if (typeof id !== 'string' || typeof title !== 'string' || typeof entrypoint !== 'string') {
      continue;
    }
    const match = normalizeChatWidgetMatch(item.match);
    if (!match) continue;
    out.push({
      id,
      title,
      entrypoint,
      match,
      maxHeight: typeof item.maxHeight === 'number' ? item.maxHeight : undefined,
      interactive: typeof item.interactive === 'boolean' ? item.interactive : undefined,
    });
  }
  return out.length ? out : undefined;
}

function normalizePages(raw: unknown): PageContribution[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PageContribution[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = item.id;
    const title = item.title;
    const path = item.path;
    const entrypoint = item.entrypoint;
    if (
      typeof id !== 'string' ||
      typeof title !== 'string' ||
      typeof path !== 'string' ||
      typeof entrypoint !== 'string'
    ) {
      continue;
    }
    out.push({
      id,
      title,
      path,
      entrypoint,
      showInNav: typeof item.showInNav === 'boolean' ? item.showInNav : undefined,
      navIcon: typeof item.navIcon === 'string' ? item.navIcon : undefined,
      when: typeof item.when === 'string' && item.when.length > 0 ? item.when : undefined,
    });
  }
  return out.length ? out : undefined;
}

function normalizeCommands(raw: unknown): CommandContribution[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CommandContribution[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = item.id;
    const title = item.title;
    if (typeof id !== 'string' || typeof title !== 'string') continue;
    out.push({
      id,
      title,
      shortcut: typeof item.shortcut === 'string' ? item.shortcut : undefined,
      opensPanel: typeof item.opensPanel === 'string' ? item.opensPanel : undefined,
      chatAlias:
        typeof item.chatAlias === 'string' && item.chatAlias.length > 0 ? item.chatAlias : undefined,
      when: typeof item.when === 'string' && item.when.length > 0 ? item.when : undefined,
    });
  }
  return out.length ? out : undefined;
}

function normalizeStatusBarItems(raw: unknown): StatusBarItemContribution[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: StatusBarItemContribution[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = item.id;
    const entrypoint = item.entrypoint;
    if (typeof id !== 'string' || typeof entrypoint !== 'string') continue;
    const position = item.position;
    out.push({
      id,
      entrypoint,
      position: position === 'left' || position === 'right' ? position : undefined,
      width: typeof item.width === 'number' ? item.width : undefined,
      when: typeof item.when === 'string' && item.when.length > 0 ? item.when : undefined,
    });
  }
  return out.length ? out : undefined;
}

function normalizeStringArrayMap(
  raw: unknown,
): Record<string, string[]> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) {
      const arr = v.filter((x): x is string => typeof x === 'string');
      if (arr.length) out[k] = arr;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeProviderAuthChoices(raw: unknown): ProviderAuthChoice[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ProviderAuthChoice[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const provider = item.provider;
    const method = item.method;
    const choiceId = item.choiceId;
    const choiceLabel = item.choiceLabel;
    if (
      typeof provider !== 'string' ||
      typeof choiceId !== 'string' ||
      typeof choiceLabel !== 'string' ||
      (method !== 'api-key' && method !== 'oauth' && method !== 'cli' && method !== 'env')
    ) {
      continue;
    }
    out.push({
      provider,
      method,
      choiceId,
      choiceLabel,
      choiceHint: typeof item.choiceHint === 'string' ? item.choiceHint : undefined,
      groupId: typeof item.groupId === 'string' ? item.groupId : undefined,
      groupLabel: typeof item.groupLabel === 'string' ? item.groupLabel : undefined,
      groupHint: typeof item.groupHint === 'string' ? item.groupHint : undefined,
      cliFlag: typeof item.cliFlag === 'string' ? item.cliFlag : undefined,
      cliOption: typeof item.cliOption === 'string' ? item.cliOption : undefined,
      cliDescription: typeof item.cliDescription === 'string' ? item.cliDescription : undefined,
    });
  }
  return out.length ? out : undefined;
}

function normalizeModelSupport(raw: unknown): ModelSupportDeclaration | undefined {
  if (!isRecord(raw)) return undefined;
  const modelPrefixes = Array.isArray(raw.modelPrefixes)
    ? raw.modelPrefixes.filter((x): x is string => typeof x === 'string')
    : undefined;
  const modelPatterns = Array.isArray(raw.modelPatterns)
    ? raw.modelPatterns.filter((x): x is string => typeof x === 'string')
    : undefined;
  if (!modelPrefixes?.length && !modelPatterns?.length) return undefined;
  return { modelPrefixes, modelPatterns };
}

function normalizeActivation(raw: unknown): ActivationDeclaration | undefined {
  if (!isRecord(raw)) return undefined;
  const onProviders = Array.isArray(raw.onProviders)
    ? raw.onProviders.filter((x): x is string => typeof x === 'string')
    : undefined;
  const onCommands = Array.isArray(raw.onCommands)
    ? raw.onCommands.filter((x): x is string => typeof x === 'string')
    : undefined;
  const onChannels = Array.isArray(raw.onChannels)
    ? raw.onChannels.filter((x): x is string => typeof x === 'string')
    : undefined;
  const capRaw = raw.onCapabilities;
  const onCapabilities = Array.isArray(capRaw)
    ? capRaw.filter(
        (x): x is 'provider' | 'channel' | 'tool' | 'hook' =>
          x === 'provider' || x === 'channel' || x === 'tool' || x === 'hook',
      )
    : undefined;
  if (!onProviders?.length && !onCommands?.length && !onChannels?.length && !onCapabilities?.length) {
    return undefined;
  }
  return { onProviders, onCommands, onChannels, onCapabilities };
}

function normalizeContracts(raw: unknown): ContractDeclaration | undefined {
  if (!isRecord(raw)) return undefined;
  const pick = (k: string) =>
    Array.isArray(raw[k]) ? raw[k].filter((x: unknown): x is string => typeof x === 'string') : undefined;
  const c: ContractDeclaration = {
    mediaUnderstandingProviders: pick('mediaUnderstandingProviders'),
    speechProviders: pick('speechProviders'),
    imageGenerationProviders: pick('imageGenerationProviders'),
    webSearchProviders: pick('webSearchProviders'),
    memoryProviders: pick('memoryProviders'),
  };
  if (
    !c.mediaUnderstandingProviders?.length &&
    !c.speechProviders?.length &&
    !c.imageGenerationProviders?.length &&
    !c.webSearchProviders?.length &&
    !c.memoryProviders?.length
  ) {
    return undefined;
  }
  return c;
}

function normalizeSetup(raw: unknown): SetupDeclaration | undefined {
  if (!isRecord(raw)) return undefined;
  const requiresRuntime = typeof raw.requiresRuntime === 'boolean' ? raw.requiresRuntime : undefined;
  let providers: SetupDeclaration['providers'];
  if (Array.isArray(raw.providers)) {
    providers = [];
    for (const p of raw.providers) {
      if (!isRecord(p) || typeof p.id !== 'string') continue;
      providers.push({
        id: p.id,
        authMethods: Array.isArray(p.authMethods)
          ? p.authMethods.filter((x): x is string => typeof x === 'string')
          : undefined,
        envVars: Array.isArray(p.envVars)
          ? p.envVars.filter((x): x is string => typeof x === 'string')
          : undefined,
      });
    }
    if (providers.length === 0) providers = undefined;
  }
  if (!providers && requiresRuntime === undefined) return undefined;
  return { providers, requiresRuntime };
}
