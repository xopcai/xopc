/**
 * `PATCH /api/config` — tail sections that are each <50 lines:
 *   update / session / gateway.{skillsMarketplaceProvider,
 *   skillsStoreBaseUrl} / providers / providersConfig / stt / tts / tools /
 *   userContext / tunnel / bindings / mcp.
 *
 * Most of these delegate to a `mergeXxxConfigPatch(config, body) → { ok,
 * message? }` helper that lives next to the schema, so this file is mostly
 * "validate object shape, call helper, surface 400 on failure". The async
 * `providers` branch saves into the credential resolver rather than config.
 *
 * Final validation (resolveGatewayAuth + assertGatewayRuntimeConfig) runs
 * after every gateway-touching patch lands, so it sees the merged shape.
 */
import type { Config } from '../../../../config/schema.js';
import { BindingsConfigSchema, BrowserConfigSchema, McpConfigSchema, VoiceConfigSchema } from '../../../../config/schema.js';
import { CredentialResolver } from '../../../../auth/credentials.js';
import { isMaskedSecretPatchValue } from '../../lib/mask-secret-length.js';
import { applyToolsWebPatch } from '../../../config-tools-web.js';
import { mergeTunnelConfigPatch } from '../../../../tunnel/tunnel-config.js';
import { canonicalizeConfiguredMcpServer } from '../../../../config/mcp-config-normalize.js';
import { setTuiDefaultAgentConfig } from '../../../../commands/agents.config.js';
import {
  mergeGatewaySkillsMarketplacePatch,
  mergeSessionConfigPatch,
  mergeUpdateConfigPatch,
} from '../../../../config/web-patch.js';
import { mergeSttConfigPatch, mergeTtsConfigPatch, mergeRealtimeVoiceConfigPatch } from '../../lib/safe-voice-config.js';
import { assertGatewayRuntimeConfig } from '../../../runtime-config.js';
import { resolveGatewayAuth, assertGatewayAuthConfigured } from '../../../auth.js';
import {
  ContextPlanningConfigSchema,
  KnowledgeMemoryConfigSchema,
  UserContextConfigSchema,
  UserModelConfigSchema,
} from '../../../../user-context/config.js';
import { type PatchResult, PATCH_OK, patchError } from './result.js';

export async function applyMiscPatch(config: Config, body: any): Promise<PatchResult> {
  if (body.update !== undefined && typeof body.update === 'object' && body.update !== null) {
    const updateResult = mergeUpdateConfigPatch(config, body.update as Record<string, unknown>);
    if (updateResult.ok === false) {
      return patchError(updateResult.message);
    }
  }

  if (body.session !== undefined) {
    if (typeof body.session !== 'object' || body.session === null || Array.isArray(body.session)) {
      return patchError('session must be an object');
    }
    const sessionResult = mergeSessionConfigPatch(config, body.session as Record<string, unknown>);
    if (sessionResult.ok === false) {
      return patchError(sessionResult.message);
    }
  }

  if (body.userContext !== undefined) {
    if (typeof body.userContext !== 'object' || body.userContext === null || Array.isArray(body.userContext)) {
      return patchError('userContext must be an object');
    }
    const userContextPatch = body.userContext as Record<string, unknown>;
    const unknownKeys = Object.keys(userContextPatch)
      .filter((key) => !['enabled', 'preferences', 'userModel', 'knowledgeMemory', 'contextPlanning'].includes(key));
    if (unknownKeys.length) {
      return patchError(`Unknown userContext settings: ${unknownKeys.join(', ')}`);
    }
    if (userContextPatch.enabled !== undefined) {
      if (typeof userContextPatch.enabled !== 'boolean') return patchError('userContext.enabled must be a boolean');
      config.userContext = { ...config.userContext, enabled: userContextPatch.enabled };
    }
    if (userContextPatch.preferences !== undefined) {
      const preferences = userContextPatch.preferences;
      if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
        return patchError('userContext.preferences must be an object');
      }
      config.userContext = {
        ...config.userContext,
        preferences: { ...config.userContext.preferences, ...preferences },
      } as Config['userContext'];
    }
    if (userContextPatch.userModel !== undefined) {
      const patch = userContextPatch.userModel;
      if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
        return patchError('userContext.userModel must be an object');
      }
      const raw = patch as Record<string, unknown>;
      const parsed = UserModelConfigSchema.safeParse({
        ...config.userContext.userModel,
        ...raw,
        ...(raw.extraction && typeof raw.extraction === 'object'
          ? { extraction: { ...config.userContext.userModel.extraction, ...raw.extraction } }
          : {}),
        ...(raw.maintenance && typeof raw.maintenance === 'object'
          ? { maintenance: { ...config.userContext.userModel.maintenance, ...raw.maintenance } }
          : {}),
      });
      if (!parsed.success) {
        return patchError(parsed.error.issues.map((issue) => issue.message).join('; '));
      }
      config.userContext = { ...config.userContext, userModel: parsed.data };
    }
    if (userContextPatch.knowledgeMemory !== undefined) {
      const patch = userContextPatch.knowledgeMemory;
      if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
        return patchError('userContext.knowledgeMemory must be an object');
      }
      const parsed = KnowledgeMemoryConfigSchema.safeParse({
        ...config.userContext.knowledgeMemory,
        ...patch,
      });
      if (!parsed.success) {
        return patchError(parsed.error.issues.map((issue) => issue.message).join('; '));
      }
      config.userContext = { ...config.userContext, knowledgeMemory: parsed.data };
    }
    if (userContextPatch.contextPlanning !== undefined) {
      const patch = userContextPatch.contextPlanning;
      if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
        return patchError('userContext.contextPlanning must be an object');
      }
      const raw = patch as Record<string, unknown>;
      const parsed = ContextPlanningConfigSchema.safeParse({
        ...config.userContext.contextPlanning,
        ...raw,
        ...(raw.compaction && typeof raw.compaction === 'object'
          ? { compaction: { ...config.userContext.contextPlanning.compaction, ...raw.compaction } }
          : {}),
      });
      if (!parsed.success) {
        return patchError(parsed.error.issues.map((issue) => issue.message).join('; '));
      }
      config.userContext = { ...config.userContext, contextPlanning: parsed.data };
    }
    const parsedUserContext = UserContextConfigSchema.safeParse(config.userContext);
    if (!parsedUserContext.success) {
      return patchError(parsedUserContext.error.issues.map((issue) => issue.message).join('; '));
    }
    config.userContext = parsedUserContext.data;
  }

  if (body.tui !== undefined) {
    if (typeof body.tui !== 'object' || body.tui === null || Array.isArray(body.tui)) {
      return patchError('tui must be an object');
    }
    const tuiPatch = body.tui as Record<string, unknown>;
    if (tuiPatch.defaultAgent !== undefined) {
      if (tuiPatch.defaultAgent === null) {
        config.tui = { ...config.tui };
        delete config.tui.defaultAgent;
      } else {
        if (typeof tuiPatch.defaultAgent !== 'string' || !tuiPatch.defaultAgent.trim()) {
          return patchError('tui.defaultAgent must be a non-empty string');
        }
        const result = setTuiDefaultAgentConfig(config, tuiPatch.defaultAgent);
        if (result.ok === false) {
          return patchError(result.message);
        }
        config.tui = result.config.tui;
      }
    }
  }

  if (body.browser !== undefined) {
    if (typeof body.browser !== 'object' || body.browser === null || Array.isArray(body.browser)) {
      return patchError('browser must be an object');
    }
    const browserPatch = structuredClone(body.browser) as Record<string, unknown>;
    const driver = browserPatch.driver && typeof browserPatch.driver === 'object' && !Array.isArray(browserPatch.driver)
      ? browserPatch.driver as Record<string, unknown>
      : undefined;
    if (driver?.kind === 'remote' && typeof driver.apiKey === 'string' && isMaskedSecretPatchValue(driver.apiKey)) {
      const currentKey = config.browser.driver.kind === 'remote' ? config.browser.driver.apiKey : undefined;
      if (currentKey) driver.apiKey = currentKey;
      else delete driver.apiKey;
    }
    const parsed = BrowserConfigSchema.safeParse(browserPatch);
    if (!parsed.success) {
      return patchError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    config.browser = parsed.data;
  }

  if (
    body.gateway !== undefined &&
    typeof body.gateway === 'object' &&
    body.gateway !== null &&
    !Array.isArray(body.gateway)
  ) {
    const gwPatch = body.gateway as Record<string, unknown>;
    if (gwPatch.skillsMarketplaceProvider !== undefined || gwPatch.skillsStoreBaseUrl !== undefined) {
      const skillsResult = mergeGatewaySkillsMarketplacePatch(config, {
        ...(gwPatch.skillsMarketplaceProvider !== undefined
          ? { skillsMarketplaceProvider: gwPatch.skillsMarketplaceProvider }
          : {}),
        ...(gwPatch.skillsStoreBaseUrl !== undefined
          ? { skillsStoreBaseUrl: gwPatch.skillsStoreBaseUrl }
          : {}),
      });
      if (skillsResult.ok === false) {
        return patchError(skillsResult.message);
      }
    }
  }

  // LLM provider credentials — saved into the credential system (not config).
  if (body.providers) {
    const resolver = new CredentialResolver();
    for (const [key, apiKey] of Object.entries(body.providers)) {
      if (
        apiKey !== undefined &&
        typeof apiKey === 'string' &&
        apiKey.trim() &&
        !isMaskedSecretPatchValue(apiKey)
      ) {
        await resolver.saveApiKey(key, apiKey, { profileName: 'default' });
      }
    }
  }

  // Non-secret provider connection settings.
  if (body.providersConfig && typeof body.providersConfig === 'object' && !Array.isArray(body.providersConfig)) {
    const cfgProviders = (config as { providers?: Record<string, Record<string, unknown>> }).providers ?? {};
    for (const [vendorId, raw] of Object.entries(body.providersConfig as Record<string, unknown>)) {
      if (!vendorId || typeof vendorId !== 'string') continue;
      if (raw === null) {
        delete cfgProviders[vendorId];
        continue;
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const next = (cfgProviders[vendorId] ?? {}) as Record<string, unknown>;
      const patch = raw as Record<string, unknown>;
      for (const field of ['baseUrl', 'region'] as const) {
        if (patch[field] === null || patch[field] === '') {
          delete next[field];
        } else if (typeof patch[field] === 'string') {
          const trimmed = (patch[field] as string).trim();
          next[field] = trimmed;
        }
      }
      if (patch.azure === null) {
        delete next.azure;
      } else if (patch.azure && typeof patch.azure === 'object' && !Array.isArray(patch.azure)) {
        next.azure = { ...(next.azure as Record<string, unknown> ?? {}), ...(patch.azure as Record<string, unknown>) };
      }
      if (patch.request === null) {
        delete next.request;
      } else if (patch.request && typeof patch.request === 'object' && !Array.isArray(patch.request)) {
        next.request = { ...(next.request as Record<string, unknown> ?? {}), ...(patch.request as Record<string, unknown>) };
      }
      cfgProviders[vendorId] = next;
    }
    (config as { providers?: Record<string, Record<string, unknown>> }).providers = cfgProviders;
  }

  // PATCH `stt` writes to tools.media.audio; PATCH `tts` writes to messages.tts.
  if (body.stt !== undefined) {
    config.tools = config.tools ?? {};
    config.tools.media = config.tools.media ?? {};
    (config.tools.media as Record<string, unknown>).audio = mergeSttConfigPatch(
      config.tools.media.audio,
      body.stt,
    );
  }
  if (body.tts !== undefined) {
    config.messages = config.messages ?? {};
    (config.messages as Record<string, unknown>).tts = mergeTtsConfigPatch(
      config.messages.tts,
      body.tts,
    );
  }
  if (body.voice !== undefined) {
    const parsed = VoiceConfigSchema.safeParse(mergeRealtimeVoiceConfigPatch(config.voice, body.voice));
    if (!parsed.success) {
      return patchError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    config.voice = parsed.data;
  }

  const toolsPatchErr = applyToolsWebPatch(config, body as Record<string, unknown>);
  if (toolsPatchErr) {
    return patchError(toolsPatchErr);
  }

  if (body.tunnel !== undefined) {
    if (!body.tunnel || typeof body.tunnel !== 'object' || Array.isArray(body.tunnel)) {
      return patchError('tunnel must be an object');
    }
    const tunnelResult = mergeTunnelConfigPatch(config, body.tunnel as Record<string, unknown>);
    if (tunnelResult.ok === false) {
      return patchError(tunnelResult.message);
    }
  }

  if (body.bindings !== undefined) {
    if (!Array.isArray(body.bindings)) {
      return patchError('bindings must be an array');
    }
    const parsed = BindingsConfigSchema.safeParse(body.bindings);
    if (!parsed.success) {
      return patchError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    config.bindings = parsed.data;
  }

  if (body.mcp !== undefined) {
    if (body.mcp === null) {
      delete config.mcp;
    } else if (typeof body.mcp !== 'object' || Array.isArray(body.mcp)) {
      return patchError('mcp must be an object');
    } else {
      const parsed = McpConfigSchema.safeParse(body.mcp);
      if (!parsed.success) {
        return patchError(parsed.error.issues.map((i) => i.message).join('; '));
      }
      if (parsed.data === undefined) {
        delete config.mcp;
      } else {
        const next = { ...parsed.data };
        if (next.servers) {
          next.servers = Object.fromEntries(
            Object.entries(next.servers).map(([name, server]) => [
              name,
              canonicalizeConfiguredMcpServer(server as Record<string, unknown>),
            ]),
          );
        }
        config.mcp = next;
      }
    }
  }

  return PATCH_OK;
}

/**
 * Re-validate gateway runtime config when `body.gateway` touched anything that
 * could break the bind/auth contract. Runs *after* all per-section patches
 * land so it sees the fully merged shape.
 */
export function validateGatewayAfterPatch(config: Config, body: any): PatchResult {
  if (body.gateway === undefined) return PATCH_OK;
  try {
    const port = config.gateway?.port ?? 18790;
    const auth = resolveGatewayAuth({ authConfig: config.gateway?.auth });
    assertGatewayAuthConfigured(auth);
    assertGatewayRuntimeConfig({
      cfg: config,
      auth,
      port,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return patchError(message);
  }
  return PATCH_OK;
}
