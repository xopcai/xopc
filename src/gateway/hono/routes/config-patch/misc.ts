/**
 * `PATCH /api/config` — tail sections that are each <50 lines:
 *   update / goals / session / gateway.{skillsMarketplaceProvider,
 *   skillsStoreBaseUrl} / providers / providersConfig / stt / tts / tools /
 *   tunnel / bindings / mcp.
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
import { BindingsConfigSchema, BrowserConfigSchema, McpConfigSchema } from '../../../../config/schema.js';
import { CredentialResolver } from '../../../../auth/credentials.js';
import { isMaskedSecretPatchValue } from '../../lib/mask-secret-length.js';
import { applyToolsWebPatch } from '../../../config-tools-web.js';
import { mergeTunnelConfigPatch } from '../../../../tunnel/tunnel-config.js';
import { canonicalizeConfiguredMcpServer } from '../../../../config/mcp-config-normalize.js';
import { setTuiDefaultAgentConfig } from '../../../../commands/agents.config.js';
import {
  mergeGatewaySkillsMarketplacePatch,
  mergeGoalsConfigPatch,
  mergeSessionConfigPatch,
  mergeUpdateConfigPatch,
} from '../../../../config/web-patch.js';
import { mergeSttConfigPatch, mergeTtsConfigPatch } from '../../lib/safe-voice-config.js';
import { assertGatewayRuntimeConfig } from '../../../runtime-config.js';
import { resolveGatewayAuth, assertGatewayAuthConfigured } from '../../../auth.js';
import { type PatchResult, PATCH_OK, patchError } from './result.js';

export async function applyMiscPatch(config: Config, body: any): Promise<PatchResult> {
  if (body.update !== undefined && typeof body.update === 'object' && body.update !== null) {
    const updateResult = mergeUpdateConfigPatch(config, body.update as Record<string, unknown>);
    if (updateResult.ok === false) {
      return patchError(updateResult.message);
    }
  }

  if (body.goals !== undefined) {
    if (typeof body.goals !== 'object' || body.goals === null || Array.isArray(body.goals)) {
      return patchError('goals must be an object');
    }
    const goalsResult = mergeGoalsConfigPatch(config, body.goals as Record<string, unknown>);
    if (goalsResult.ok === false) {
      return patchError(goalsResult.message);
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

  if (body.tui !== undefined) {
    if (typeof body.tui !== 'object' || body.tui === null || Array.isArray(body.tui)) {
      return patchError('tui must be an object');
    }
    const tuiPatch = body.tui as Record<string, unknown>;
    if (tuiPatch.defaultAgent !== undefined) {
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

  if (body.browser !== undefined) {
    if (typeof body.browser !== 'object' || body.browser === null || Array.isArray(body.browser)) {
      return patchError('browser must be an object');
    }
    const parsed = BrowserConfigSchema.safeParse(body.browser);
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

  // Structured per-vendor provider config (cfg.providers.<id>) for capability
  // providers (image / audio / video). Distinct from `body.providers` above
  // which targets the LLM-side credential resolver.
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
      for (const field of ['apiKey', 'baseUrl', 'region', 'imageBaseUrl'] as const) {
        if (patch[field] === null || patch[field] === '') {
          delete next[field];
        } else if (typeof patch[field] === 'string') {
          const trimmed = (patch[field] as string).trim();
          if (field === 'apiKey' && isMaskedSecretPatchValue(trimmed)) {
            continue;
          }
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
    const auth = resolveGatewayAuth({ authConfig: config.gateway?.auth });
    assertGatewayAuthConfigured(auth);
    assertGatewayRuntimeConfig({
      cfg: config,
      auth,
      port: config.gateway?.port ?? 18790,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return patchError(message);
  }
  return PATCH_OK;
}
