/**
 * Agent tool: create_share
 *
 * Hands a generated artefact (file, folder, HTML site) to the share-auto
 * pipeline and returns a public URL the model can paste into its reply.
 *
 * This is the bridge between "agent produces files" and "user has something
 * to share with a friend on WeChat (or anywhere)" — the model itself decides
 * when to call it, with optional hints about audience.
 */
import { Type } from '@sinclair/typebox';
import { createHash } from 'node:crypto';
import { AgentTool, type AgentToolResult } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { resolveGatewayEffectiveHost } from '../../config/gateway-bind.js';
import { resolveShareConfig } from '../../share/share-config.js';
import { mergeWithDefaults as resolveSiteShareConfigFromRaw } from '../../share/site-share-config.js';
import { getShareStore } from '../../share/share-store.js';
import { getSiteShareStore } from '../../share/site-share-store.js';
import { resolveShareUrl, resolveSiteShareUrl } from '../../share/share-url.js';
import { resolveReverseProxyPublicUrl } from '../../gateway/public-url.js';
import {
  audienceDefaults,
  decideShareKind,
  makeDescription,
  makeTitle,
  probeShareTarget,
  rememberStagedSite,
  stageSingleHtmlAsSite,
  type ShareAudience,
  type ShareAutoMode,
} from '../../share/share-auto.js';
import { scheduleThumbnail } from '../../share/share-thumbnail.js';
import {
  resolveToolLocale,
  shareToolErrorLine,
  shareToolSuccessLines,
} from '../../i18n/share-tool-bundle.js';
import { resolvePathUnderWorkspace } from './tool-paths.js';

const CreateShareSchema = Type.Object({
  filePath: Type.String({
    description:
      'File or folder to share. Relative paths resolve under the agent workspace; absolute paths are used as given (must be inside the workspace).',
  }),
  audience: Type.Optional(Type.Enum(
    { friend: 'friend', colleague: 'colleague', public: 'public' },
    {
      description:
        'Who the recipient is — controls default TTL/view caps. friend=3d unlimited, colleague=7d unlimited, public=24h capped at 100 views. Default: friend.',
    },
  )),
  title: Type.Optional(Type.String({ description: 'Override title shown on the social card. Default: file basename without extension.' })),
  description: Type.Optional(Type.String({ description: 'Optional 1-line description for the social card.' })),
  mode: Type.Optional(Type.Enum(
    { auto: 'auto', 'force-file': 'force-file', 'force-site': 'force-site', 'force-zip': 'force-zip' },
    { description: "Override routing. Default 'auto'. Use 'force-site' to publish a single HTML as a hosted page." },
  )),
});

type CreateShareParams = {
  filePath: string;
  audience?: ShareAudience;
  title?: string;
  description?: string;
  mode?: ShareAutoMode;
};

export interface CreateShareToolDeps {
  workspace: string;
  getConfig: () => Config | undefined;
  /** Optional agent id for workspace resolution audit (currently unused but kept for parity with /api/shares). */
  getAgentId?: () => string | undefined;
  /**
   * Optional user-facing locale ('en' / 'zh' / etc.). Falls back to env LANG
   * → DEFAULT_SERVER_LOCALE when unset. Returned text follows this locale;
   * the structured `details` payload stays language-neutral.
   */
  getLocale?: () => string | undefined;
}

/**
 * Whether the create_share tool is worth registering. Returns false when:
 *  - no gateway config is present (sharing routes wouldn't be reachable anyway), or
 *  - BOTH file sharing (`gateway.share.enabled`) and site sharing
 *    (`gateway.siteShare.enabled`) are explicitly disabled.
 *
 * Reachability (`tunnel up?`) is intentionally NOT checked here — it is
 * runtime state, the tool surfaces it via the `reachability` field, and the
 * agent should still be able to create local-only shares when the user is
 * testing or on the same network.
 */
export function isShareToolAvailable(cfg: Config | undefined): boolean {
  if (!cfg || !cfg.gateway) return false;
  const gw = cfg.gateway as Record<string, unknown>;
  const fileEnabled = (gw.share as { enabled?: boolean } | undefined)?.enabled !== false;
  const siteEnabled = (gw.siteShare as { enabled?: boolean } | undefined)?.enabled !== false;
  return fileEnabled || siteEnabled;
}

function gatewayPortOf(cfg: Config | undefined): number {
  return cfg?.gateway?.port ?? 18790;
}

function hashCreator(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

export function createCreateShareTool(deps: CreateShareToolDeps): AgentTool {
  const { workspace, getConfig } = deps;

  return {
    name: 'create_share',
    description:
      'Create a public share link for a file or folder so it can be sent to a friend (e.g. via WeChat). Returns shareUrl + thumbnailUrl + expiry. HTML files are published as live pages (the recipient sees a rendered page, not a download).',
    parameters: CreateShareSchema,
    label: '🔗 Create Share',

    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<Record<string, unknown>>> {
      const p = params as CreateShareParams;
      const audience: ShareAudience = p.audience ?? 'friend';
      const mode: ShareAutoMode = p.mode ?? 'auto';
      const locale = resolveToolLocale(deps.getLocale?.());

      const cfg = getConfig();
      const shareCfg = resolveShareConfig(
        (cfg?.gateway as Record<string, unknown> | undefined)?.share,
      );
      const siteCfg = resolveSiteShareConfigFromRaw(
        (cfg?.gateway as Record<string, unknown> | undefined)?.siteShare,
      );
      const gatewayHost = cfg ? resolveGatewayEffectiveHost(cfg) : '127.0.0.1';
      const gatewayPort = gatewayPortOf(cfg);
      const reverseProxyPublicUrl = resolveReverseProxyPublicUrl(cfg);
      const urlCtx = { gatewayHost, gatewayPort, reverseProxyPublicUrl };
      const tokenHash = hashCreator(deps.getAgentId?.() ?? 'agent-tool');

      // Resolve absolute path + verify it sits under the workspace root.
      const absolutePath = resolvePathUnderWorkspace(p.filePath, workspace);
      if (!absolutePath.startsWith(workspace)) {
        return errorResult(locale,'File must be inside the agent workspace.');
      }
      const relPath = absolutePath === workspace
        ? ''
        : absolutePath.slice(workspace.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
      if (!relPath) {
        return errorResult(locale,'Cannot share the workspace root itself.');
      }

      let probe;
      try {
        probe = await probeShareTarget(workspace, relPath);
      } catch (err) {
        return errorResult(locale,`Cannot read target: ${err instanceof Error ? err.message : String(err)}`);
      }

      let decision;
      try {
        decision = decideShareKind(probe, mode);
      } catch (err) {
        return errorResult(locale,err instanceof Error ? err.message : String(err));
      }

      const defaults = audienceDefaults(audience);
      const ttlMs = defaults.ttlMs;
      const maxViews = defaults.maxViews;

      try {
        if (decision.kind === 'site') {
          const siteStore = getSiteShareStore(siteCfg);
          let sitePath = relPath;
          let stagedDir: string | null = null;
          if (probe.kind === 'file') {
            const staged = await stageSingleHtmlAsSite(workspace, probe.absolutePath);
            sitePath = staged.relativePath;
            stagedDir = staged.stagingDir;
          }
          const siteRec = await siteStore.create({
            kind: 'static',
            path: sitePath,
            ttlMs,
            description: p.description,
            spaFallback: true,
            rewriteMode: 'html-css',
            workspaceRoot: workspace,
            gatewayTokenHash: tokenHash,
          });
          if (stagedDir) rememberStagedSite(siteRec.id, stagedDir);

          const subdomainLabel = siteRec.subdomain ?? siteRec.token;
          const resolved = resolveSiteShareUrl({
            ...urlCtx,
            token: siteRec.token,
            subdomainLabel,
            publicHostSuffix: siteCfg.publicHostSuffix,
          });
          scheduleThumbnail(
            { scope: 'site', token: siteRec.token, recordId: siteRec.id },
            {
              config: shareCfg.thumbnail,
              internalBaseUrl: shareCfg.thumbnail.internalGatewayUrl ?? `http://127.0.0.1:${gatewayPort}`,
            },
          );
          siteStore.setThumbnailStatus(siteRec.id, 'pending');

          const titleOut = makeTitle(probe.kind === 'directory' ? (relPath.split('/').pop() || relPath) : (probe.absolutePath.split(/[\\/]/).pop() || relPath), p.title);
          const descOut = makeDescription({ audience, expiresAt: siteRec.expiresAt, override: p.description });

          return successResult(locale, {
            kind: 'site',
            shareUrl: resolved.shareUrl,
            thumbnailUrl: resolved.thumbnailUrl,
            reachability: resolved.reachability,
            reachabilityHint: resolved.reachabilityHint,
            title: titleOut,
            description: descOut,
            expiresAt: siteRec.expiresAt,
            routing: { reason: decision.reason, hint: decision.hint },
          });
        }

        // file or zip — uses ShareStore
        const fileStore = getShareStore(shareCfg);
        const rec = await fileStore.create({
          path: relPath,
          workspaceRoot: workspace,
          gatewayTokenHash: tokenHash,
          ttlMs,
          maxViews: maxViews === undefined ? undefined : maxViews,
          description: p.description,
          kind: probe.kind === 'directory' ? 'directory' : 'file',
          directoryMode: decision.kind === 'zip' ? 'zip-only' : (probe.kind === 'directory' ? 'browse' : undefined),
        });
        const resolved = resolveShareUrl(rec.token, urlCtx);
        const thumbnailUrl = `${resolved.shareUrl}/thumbnail`;
        scheduleThumbnail(
          { scope: 'file', token: rec.token, recordId: rec.id },
          {
            config: shareCfg.thumbnail,
            internalBaseUrl: shareCfg.thumbnail.internalGatewayUrl ?? `http://127.0.0.1:${gatewayPort}`,
          },
        );
        fileStore.setThumbnailStatus(rec.id, 'pending');
        const titleOut = makeTitle(rec.fileName, p.title);
        const descOut = makeDescription({ audience, expiresAt: rec.expiresAt, override: p.description });

        return successResult(locale, {
          kind: decision.kind,
          shareUrl: resolved.shareUrl,
          thumbnailUrl,
          reachability: resolved.reachability,
          reachabilityHint: resolved.reachabilityHint,
          title: titleOut,
          description: descOut,
          expiresAt: rec.expiresAt,
          maxViews: rec.maxViews,
          routing: { reason: decision.reason, hint: decision.hint },
        });
      } catch (err) {
        return errorResult(locale,err instanceof Error ? err.message : String(err));
      }
    },
  } as any;
}

function successResult(
  locale: ReturnType<typeof resolveToolLocale>,
  payload: Record<string, unknown>,
): AgentToolResult<Record<string, unknown>> {
  const lines = shareToolSuccessLines(locale, {
    kind: String(payload.kind ?? ''),
    shareUrl: String(payload.shareUrl ?? ''),
    title: String(payload.title ?? ''),
    expiresAt: String(payload.expiresAt ?? ''),
    thumbnailUrl: String(payload.thumbnailUrl ?? ''),
    reachability: String(payload.reachability ?? ''),
    reachabilityHint: String(payload.reachabilityHint ?? ''),
    isPublic: payload.reachability === 'public',
  }).filter(Boolean);
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    details: payload,
  };
}

function errorResult(
  locale: ReturnType<typeof resolveToolLocale>,
  message: string,
): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: 'text', text: shareToolErrorLine(locale, message) }],
    details: { error: message },
  };
}
