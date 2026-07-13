/**
 * GatewayMarketplaceService — install / browse / remove for the two marketplaces
 * the gateway exposes:
 *
 *   • **Skills** (`~/.xopc/skills/managed/<id>`) — zip-bundled markdown skills
 *     pulled from a provider catalog (`agent/skills/skills-marketplace.ts`).
 *   • **Extensions** (`~/.xopc/extensions/<id>`) — full extension packages from
 *     the xopc-store.
 *
 * Owns the install/uninstall composite operations:
 *   - download zip → unpack → upsert lockfile → refresh loader → emit reload
 *   - rm dir → remove from `extensions.enabled` → refresh loader → emit reload
 *
 * Local-only skill management (install-from-zip, delete, enable/disable, list)
 * lives here too so callers (commands-skills routes) depend on a single narrow
 * service instead of the full `GatewayService`.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { Config } from '../../config/schema.js';
import type { AgentService } from '../../agent/service.js';
import type { ChannelManager } from '../../channels/manager.js';
import type { ExtensionLoader } from '../../extensions/loader.js';
import type {
  AgentSkillAvailabilityEntry,
  AgentSkillAvailabilityPayload,
  SkillCatalogEntry,
  SkillCatalogRuntimeMeta,
} from '../../agent/agent-manager.js';
import type {
  ManagedSkillListItem,
} from '../../agent/skills/managed-store.js';
import type { SkillMarkdownPreviewPayload } from '../../agent/skills/types.js';
import type {
  MarketplaceCategoryOption,
  SkillsStoreListParams,
  UnifiedMarketplaceListResponse,
  UnifiedMarketplacePackageDetail,
} from '../../agent/skills/skills-marketplace.js';
import type { MarketplacePackageDetail } from '../../agent/skills/marketplace/adapters/store/store-api-client.js';
import {
  deleteManagedSkill as deleteManagedSkillDir,
  installSkillFromZip,
  listManagedSkillDirs,
} from '../../agent/skills/managed-store.js';
import { createSkillConfigManager } from '../../agent/skills/config.js';
import { removeSkillsLockEntry } from '../../agent/skills/hub-lock.js';
import type { HubPullResult } from '../../agent/skills/hub-pull.js';
import {
  normalizeSkillInstallTarget,
  type SkillInstallTarget,
} from '../../agent/skills/install-target.js';
import {
  resolveWorkspaceSkillsDir,
  resolveWorkspaceSkillsLockPath,
} from '../../agent/skills/workspace-skills-dir.js';
import { getExtensionLockfileManager } from '../../extensions/lockfile.js';
import { resolveExtensionsDir, resolveStateDir } from '../../config/paths.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Gateway:Marketplace');

export interface GatewayMarketplaceServiceOptions {
  getConfig: () => Config;
  getAgentService: () => AgentService;
  getExtensionLoader: () => ExtensionLoader | null;
  getChannelManager: () => ChannelManager;
  getWorkspacePath: () => string;
  saveConfig: (config: Config) => Promise<{ saved: boolean; error?: string }>;
  emit: (type: string, payload: unknown) => void;
}

export interface SkillInstallAvailability {
  skillId: string;
  skillName?: string;
  loaded: boolean;
  enabled?: boolean;
  defaultAgentId: string;
  availableForDefaultAgent?: boolean;
  unavailableReason?: AgentSkillAvailabilityEntry['unavailableReason'];
  diagnostics: SkillCatalogRuntimeMeta['diagnostics'];
}

export interface SkillInstallResultPayload {
  skillId: string;
  path: string;
  target?: SkillInstallTarget;
  availability: SkillInstallAvailability;
}

export interface SkillSourceInstallOptions {
  source: string;
  ref?: string;
  path?: string;
  skillId?: string;
  target?: SkillInstallTarget;
  force?: boolean;
  strictScan?: boolean;
}

export interface SkillSourceInstallResultPayload extends SkillInstallResultPayload {
  source: string;
  kind: HubPullResult['kind'];
  contentHash: string;
}

export class GatewayMarketplaceService {
  private readonly opts: GatewayMarketplaceServiceOptions;

  constructor(opts: GatewayMarketplaceServiceOptions) {
    this.opts = opts;
  }

  private resolveInstallTarget(target: unknown): {
    target: SkillInstallTarget;
    rootDir?: string;
    lockPath?: string;
  } {
    const normalized = normalizeSkillInstallTarget(target);
    if (normalized === 'global') {
      return { target: normalized };
    }
    const workspace = this.opts.getWorkspacePath();
    return {
      target: normalized,
      rootDir: resolveWorkspaceSkillsDir(workspace),
      lockPath: resolveWorkspaceSkillsLockPath(workspace),
    };
  }

  // ── Local skills (managed dir) ────────────────────────────────────────

  getSkillsApi(): {
    catalog: SkillCatalogEntry[];
    managed: ManagedSkillListItem[];
  } & SkillCatalogRuntimeMeta {
    const snapshot = this.opts.getAgentService().getSkillCatalogSnapshot();
    return {
      catalog: snapshot.catalog,
      managed: listManagedSkillDirs(),
      version: snapshot.version,
      loadedAt: snapshot.loadedAt,
      diagnostics: snapshot.diagnostics,
      status: snapshot.status,
    };
  }

  getSkillsStatusApi(): SkillCatalogRuntimeMeta {
    const snapshot = this.opts.getAgentService().getSkillCatalogSnapshot();
    return {
      version: snapshot.version,
      loadedAt: snapshot.loadedAt,
      diagnostics: snapshot.diagnostics,
      status: snapshot.status,
    };
  }

  getAgentSkillsApi(agentId: string): AgentSkillAvailabilityPayload {
    return this.opts.getAgentService().getAgentSkillAvailability(agentId);
  }

  getSkillMarkdownSource(skillName: string): SkillMarkdownPreviewPayload | null {
    return this.opts.getAgentService().getSkillMarkdownSource(skillName);
  }

  deleteSkill(skillId: string, target?: SkillInstallTarget): void {
    const requestedTarget = target ? this.resolveInstallTarget(target) : undefined;
    const workspaceTarget = requestedTarget ?? this.resolveInstallTarget('workspace');
    try {
      removeSkillsLockEntry(skillId, workspaceTarget.lockPath);
      deleteManagedSkillDir(skillId, workspaceTarget.rootDir);
      this.opts.getAgentService().refreshSkillsAfterDiskChange();
      return;
    } catch (err) {
      if (requestedTarget || !(err instanceof Error) || !err.message.includes('Skill not found')) {
        throw err;
      }
    }

    removeSkillsLockEntry(skillId);
    deleteManagedSkillDir(skillId);
    this.opts.getAgentService().refreshSkillsAfterDiskChange();
  }

  installSkillZip(
    buffer: Buffer,
    opts: { skillId?: string; overwrite?: boolean; target?: SkillInstallTarget },
  ): SkillInstallResultPayload {
    const target = this.resolveInstallTarget(opts.target);
    const result = installSkillFromZip(buffer, {
      skillId: opts.skillId,
      overwrite: opts.overwrite,
      rootDir: target.rootDir,
    });
    removeSkillsLockEntry(result.skillId, target.lockPath);
    this.opts.getAgentService().refreshSkillsAfterDiskChange();
    return {
      ...result,
      target: target.target,
      availability: this.getInstallAvailability(result.skillId),
    };
  }

  reloadSkills(): void {
    this.opts.getAgentService().refreshSkillsAfterDiskChange();
  }

  patchSkillEnabled(skillName: string, enabled: boolean): void {
    createSkillConfigManager(resolveStateDir()).setSkillEnabled(skillName, enabled);
    this.opts.getAgentService().refreshSkillsAfterSkillConfigChange();
  }

  // ── Skills marketplace catalog ────────────────────────────────────────

  async fetchSkillsCatalog(
    params: SkillsStoreListParams,
    provider?: string,
  ): Promise<UnifiedMarketplaceListResponse> {
    const { listMarketplacePackages } = await import('../../agent/skills/skills-marketplace.js');
    return listMarketplacePackages(this.opts.getConfig(), params, provider);
  }

  async fetchSkillsCategories(
    provider?: string,
  ): Promise<{ items: MarketplaceCategoryOption[] }> {
    const { listMarketplaceCategories } = await import('../../agent/skills/skills-marketplace.js');
    return listMarketplaceCategories(this.opts.getConfig(), provider);
  }

  async fetchSkillsPackageDetail(
    packageName: string,
    provider?: string,
  ): Promise<UnifiedMarketplacePackageDetail> {
    const { getMarketplacePackageDetail } = await import('../../agent/skills/skills-marketplace.js');
    return getMarketplacePackageDetail(this.opts.getConfig(), packageName, provider);
  }

  async installSkill(opts: {
    name: string;
    version?: string;
    overwrite?: boolean;
    provider?: string;
    target?: SkillInstallTarget;
  }): Promise<SkillInstallResultPayload> {
    const { downloadFromMarketplace } = await import('../../agent/skills/skills-marketplace.js');
    const { buffer, skillId } = await downloadFromMarketplace(
      this.opts.getConfig(),
      opts.name,
      opts.version,
      opts.provider,
    );
    return this.installSkillZip(buffer, {
      skillId,
      overwrite: opts.overwrite ?? false,
      target: opts.target,
    });
  }

  async installSkillFromSource(
    opts: SkillSourceInstallOptions,
  ): Promise<SkillSourceInstallResultPayload> {
    const result = await this.opts.getAgentService().installSkillFromSource({
      source: opts.source,
      ref: opts.ref,
      path: opts.path,
      skillId: opts.skillId,
      target: opts.target,
      workspace: this.opts.getWorkspacePath(),
      force: opts.force ?? false,
      strictScan: opts.strictScan ?? false,
    });
    return {
      skillId: result.skillId,
      path: result.path,
      target: result.target,
      source: result.source,
      kind: result.kind,
      contentHash: result.contentHash,
      availability: this.getInstallAvailability(result.skillId),
    };
  }

  async getSkillsProvider(): Promise<{ provider: string; displayName: string }> {
    const {
      getMarketplaceProviderDisplayName,
      resolveSkillsMarketplaceProvider,
    } = await import('../../agent/skills/skills-marketplace.js');
    const provider = resolveSkillsMarketplaceProvider(this.opts.getConfig());
    return {
      provider,
      displayName: getMarketplaceProviderDisplayName(provider),
    };
  }

  /** All registered marketplace providers (built-in + extension-contributed). */
  async getSkillsProviders(): Promise<Array<{ id: string; displayName: string }>> {
    const { listRegisteredProviders } = await import('../../agent/skills/skills-marketplace.js');
    return listRegisteredProviders();
  }

  private getDefaultAgentId(): string {
    return this.opts.getConfig().agents?.default || 'main';
  }

  private getInstallAvailability(skillId: string): SkillInstallAvailability {
    const snapshot = this.opts.getAgentService().getSkillCatalogSnapshot();
    const catalogEntry =
      snapshot.catalog.find((s) => s.directoryId === skillId) ??
      snapshot.catalog.find((s) => s.name === skillId);
    const defaultAgentId = this.getDefaultAgentId();
    const agentSkills = this.getAgentSkillsApi(defaultAgentId);
    const agentEntry = catalogEntry
      ? agentSkills.skills.find((s) => s.name === catalogEntry.name)
      : undefined;
    const relevantDiagnostics = snapshot.diagnostics.filter((diag) => {
      if (!catalogEntry) return diag.path?.includes(skillId) || diag.skillName === skillId;
      return diag.skillName === catalogEntry.name || diag.path?.startsWith(catalogEntry.path);
    });
    return {
      skillId,
      ...(catalogEntry ? { skillName: catalogEntry.name } : {}),
      loaded: Boolean(catalogEntry),
      ...(catalogEntry ? { enabled: catalogEntry.enabled } : {}),
      defaultAgentId,
      ...(agentEntry ? { availableForDefaultAgent: agentEntry.availableForCurrentAgent } : {}),
      ...(agentEntry?.unavailableReason ? { unavailableReason: agentEntry.unavailableReason } : {}),
      diagnostics: relevantDiagnostics,
    };
  }

  // ── Extension marketplace ─────────────────────────────────────────────

  /** xopc-store extension package preview (type must be `extension`). */
  async fetchExtensionPackageDetail(packageName: string): Promise<MarketplacePackageDetail> {
    const {
      fetchMarketplacePackageDetail,
      resolveExtensionsStoreBaseUrl,
    } = await import('../../agent/skills/marketplace/adapters/store/store-api-client.js');
    const base = resolveExtensionsStoreBaseUrl(this.opts.getConfig());
    const detail = await fetchMarketplacePackageDetail(base, packageName.trim());
    if (detail.type !== 'extension') {
      throw new Error(
        `Package "${packageName}" is not an extension (store type: ${detail.type}).`,
      );
    }
    return detail;
  }

  /**
   * Install an extension from xopc-store into `~/.xopc/extensions`, append id
   * to `extensions.enabled`, refresh the loader, and emit `config.reload`.
   * Returns `requiresGatewayRestart=true` when a new channel plugin would have
   * to wire into the running gateway (channel registration cannot hot-patch).
   */
  async installExtension(opts: {
    name: string;
    version?: string;
    overwrite?: boolean;
  }): Promise<{ extensionId: string; version: string; requiresGatewayRestart: boolean }> {
    const packageName = opts.name.trim();
    if (!packageName) {
      throw new Error('Package name is required');
    }
    const cfg = this.opts.getConfig();
    const {
      downloadExtensionStoreZipBuffer,
      resolveExtensionZipDownloadUrl,
      resolveExtensionsStoreBaseUrl,
      verifyStoreArtifactSha256,
    } = await import('../../agent/skills/marketplace/adapters/store/store-api-client.js');
    const {
      installExtensionFromStoreZip,
      peekExtensionIdFromStoreZip,
    } = await import('../../extensions/install.js');
    const storeBase = resolveExtensionsStoreBaseUrl(cfg);
    const targetDir = resolveExtensionsDir();
    mkdirSync(targetDir, { recursive: true });

    const { downloadUrl, version, sha256 } = await resolveExtensionZipDownloadUrl(
      storeBase,
      packageName,
      opts.version,
    );
    const buf = await downloadExtensionStoreZipBuffer(storeBase, downloadUrl);
    verifyStoreArtifactSha256(buf, sha256);

    if (opts.overwrite) {
      const peekId = peekExtensionIdFromStoreZip(buf);
      if (peekId && existsSync(join(targetDir, peekId))) {
        rmSync(join(targetDir, peekId), { recursive: true, force: true });
      }
    }

    const result = await installExtensionFromStoreZip(buf, targetDir);
    if (!result.ok || !result.extensionId) {
      throw new Error(result.error ?? 'Extension install failed');
    }

    const lock = getExtensionLockfileManager();
    await lock.upsert(result.extensionId, {
      name: result.extensionId,
      version,
      resolved: packageName,
      source: 'store',
    });

    const nextConfig = this.mergeExtensionEnabledIntoConfig(cfg, result.extensionId);
    const saved = await this.opts.saveConfig(nextConfig);
    if (!saved.saved) {
      throw new Error(saved.error ?? 'Failed to save config after extension install');
    }

    const channelIdsBefore = new Set(this.opts.getChannelManager().getAllPlugins().map((p) => p.id));
    let requiresGatewayRestart = false;
    const loader = this.opts.getExtensionLoader();
    try {
      if (loader) {
        loader.invalidateManifestCache();
        await loader.loadByActivationPlan();
        const reg = loader.getRegistry();
        for (const p of reg.channelPlugins) {
          if (!channelIdsBefore.has(p.id)) {
            requiresGatewayRestart = true;
            break;
          }
        }
      }
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, errorMessage: em }, `Extension loader refresh after marketplace install failed: ${em}`);
      requiresGatewayRestart = true;
    }

    this.opts.emit('config.reload', { section: 'extensions', source: 'marketplace-install' });
    return { extensionId: result.extensionId, version, requiresGatewayRestart };
  }

  /** Remove a user-installed extension (global or per-agent dir) from disk and config. */
  async uninstallExtension(extensionId: string): Promise<{ requiresGatewayRestart: boolean }> {
    const id = extensionId.trim();
    if (!id) {
      throw new Error('extensionId is required');
    }
    const loader = this.opts.getExtensionLoader();
    if (!loader) {
      throw new Error('Extensions unavailable');
    }
    const discovered = loader.discoverExtensions();
    const ext = discovered.find((e) => e.id === id);
    if (!ext) {
      throw new Error(`Extension not found: ${id}`);
    }
    if (ext.source === 'bundled') {
      throw new Error('Built-in extensions cannot be uninstalled from the marketplace UI');
    }
    if (existsSync(ext.path)) {
      rmSync(ext.path, { recursive: true, force: true });
    }
    await getExtensionLockfileManager().remove(id);

    const nextConfig = this.mergeExtensionRemovedFromEnabledConfig(this.opts.getConfig(), id);
    const saved = await this.opts.saveConfig(nextConfig);
    if (!saved.saved) {
      throw new Error(saved.error ?? 'Failed to save config after extension uninstall');
    }
    try {
      loader.invalidateManifestCache();
      await loader.loadByActivationPlan();
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, errorMessage: em }, `Extension loader refresh after uninstall failed: ${em}`);
    }
    this.opts.emit('config.reload', { section: 'extensions', source: 'marketplace-uninstall' });
    return { requiresGatewayRestart: true };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private mergeExtensionEnabledIntoConfig(currentConfig: Config, extensionId: string): Config {
    const id = extensionId.trim();
    const prevExt = currentConfig.extensions;
    const baseExt =
      prevExt && typeof prevExt === 'object' && !Array.isArray(prevExt)
        ? { ...(prevExt as Record<string, unknown>) }
        : {};
    const enabledRaw = baseExt.enabled;
    const enabled = Array.isArray(enabledRaw)
      ? [...enabledRaw.filter((x): x is string => typeof x === 'string')]
      : [];
    if (!enabled.includes(id)) enabled.push(id);

    const disabledRaw = baseExt.disabled;
    const nextExt: Record<string, unknown> = { ...baseExt, enabled };
    if (Array.isArray(disabledRaw)) {
      const next = disabledRaw.filter((x): x is string => typeof x === 'string' && x !== id);
      if (next.length > 0) nextExt.disabled = next;
      else delete nextExt.disabled;
    }

    return {
      ...currentConfig,
      extensions: nextExt,
    } as Config;
  }

  private mergeExtensionRemovedFromEnabledConfig(currentConfig: Config, extensionId: string): Config {
    const id = extensionId.trim();
    const prevExt = currentConfig.extensions;
    const baseExt =
      prevExt && typeof prevExt === 'object' && !Array.isArray(prevExt)
        ? { ...(prevExt as Record<string, unknown>) }
        : {};
    const enabledRaw = baseExt.enabled;
    const enabled = Array.isArray(enabledRaw)
      ? enabledRaw.filter((x): x is string => typeof x === 'string' && x !== id)
      : [];
    return {
      ...currentConfig,
      extensions: { ...baseExt, enabled },
    } as Config;
  }
}
