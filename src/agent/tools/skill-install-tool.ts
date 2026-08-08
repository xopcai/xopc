import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { isSkillInstallTarget, type SkillInstallTarget } from '../skills/install-target.js';

export interface SkillInstallToolOptions {
  source: string;
  ref?: string;
  path?: string;
  skillId?: string;
  target?: SkillInstallTarget;
  /** Current session whose resolved workspace should receive workspace installs. */
  sessionKey?: string;
  /** Explicit workspace override for workspace installs. */
  workspace?: string;
  force?: boolean;
  strictScan?: boolean;
}

export interface SkillInstallToolResult {
  skillId: string;
  path: string;
  source: string;
  kind: 'git' | 'archive';
  contentHash: string;
  target?: SkillInstallTarget;
}

export interface MarketplaceSkillInstallToolOptions {
  provider: 'store' | 'clawhub';
  name: string;
  version?: string;
  target?: SkillInstallTarget;
  sessionKey?: string;
  force?: boolean;
}

export interface MarketplaceSkillInstallToolResult {
  skillId: string;
  path: string;
  provider: 'store' | 'clawhub';
  name: string;
  version?: string;
  target?: SkillInstallTarget;
}

export interface SkillInstallToolDeps {
  installSkillFromSource?: (opts: SkillInstallToolOptions) => Promise<SkillInstallToolResult>;
  installSkillFromMarketplace?: (
    opts: MarketplaceSkillInstallToolOptions,
  ) => Promise<MarketplaceSkillInstallToolResult>;
  getSessionKey?: () => string | undefined;
}

const SkillInstallSchema = Type.Object({
  source: Type.Optional(Type.String({
    description:
      'Explicit source install: Git URL, GitHub repository URL, https .zip/.tar.gz URL, file:// URL, or local archive/path.',
  })),
  provider: Type.Optional(Type.Union([Type.Literal('store'), Type.Literal('clawhub')], {
    description: 'Marketplace provider. Use with name; copy it from skills_marketplace_search.',
  })),
  name: Type.Optional(Type.String({
    description:
      'Marketplace package name or install.reference. For ClawHub prefer owner/slug to disambiguate publishers.',
  })),
  version: Type.Optional(Type.String({ description: 'Optional marketplace package version.' })),
  ref: Type.Optional(Type.String({ description: 'Optional Git branch/tag/ref.' })),
  path: Type.Optional(
    Type.String({ description: 'Optional subdirectory inside the source that contains SKILL.md.' }),
  ),
  skillId: Type.Optional(
    Type.String({ description: 'Optional target managed skill id under the selected global or workspace skills root.' }),
  ),
  target: Type.Optional(
    Type.Union([
      Type.Literal('workspace'),
      Type.Literal('global'),
    ], {
      description:
        'Install target. Defaults to global (~/.xopc/skills). Use workspace only when the user explicitly asks to scope the skill to the current agent workspace.',
    }),
  ),
  force: Type.Optional(Type.Boolean({ description: 'Replace an existing managed skill with the same id.' })),
  strictScan: Type.Optional(
    Type.Boolean({ description: 'Fail when the current scanner reports critical findings.' }),
  ),
});

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function createSkillInstallTool(deps: SkillInstallToolDeps): AgentTool {
  return {
    name: 'skill_install',
    label: 'Install skill',
    description:
      'Install an xopc skill from a Store/ClawHub marketplace result or an explicit source. ' +
      'Use only when the user clearly asks to install or update a skill; never treat search or a pasted URL as installation consent.',
    parameters: SkillInstallSchema,
    async execute(_toolCallId: string, params: any): Promise<AgentToolResult<{}>> {
      const provider = clean(params.provider);
      const name = clean(params.name);
      const target = isSkillInstallTarget(params.target) ? params.target : 'global';
      const sessionKey = deps.getSessionKey?.();

      if (provider || name) {
        if (provider !== 'store' && provider !== 'clawhub') {
          return {
            content: [{ type: 'text', text: 'Marketplace installs require provider: store or clawhub.' }],
            details: { errorCode: 'missing_provider' },
          };
        }
        if (!name) {
          return {
            content: [{ type: 'text', text: 'Marketplace installs require name from the search result.' }],
            details: { errorCode: 'missing_name' },
          };
        }
        if (!deps.installSkillFromMarketplace) {
          return {
            content: [{ type: 'text', text: 'Marketplace skill installation is not available in this runtime context.' }],
            details: { errorCode: 'marketplace_install_unavailable' },
          };
        }
        try {
          const result = await deps.installSkillFromMarketplace({
            provider,
            name,
            version: clean(params.version),
            target,
            sessionKey,
            force: params.force === true,
          });
          return {
            content: [{
              type: 'text',
              text: [
                `Installed skill "${result.skillId}" from ${result.provider}.`,
                `Package: ${result.name}${result.version ? `@${result.version}` : ''}`,
                `Target: ${result.target ?? target}`,
                `Path: ${result.path}`,
              ].join('\n'),
            }],
            details: { result },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text', text: `Marketplace skill install failed: ${message}` }],
            details: { errorCode: 'install_failed', errorMessage: message },
          };
        }
      }

      if (!deps.installSkillFromSource) {
        return {
          content: [{ type: 'text', text: 'Skill installation is not available in this runtime context.' }],
          details: {},
        };
      }

      const source = clean(params.source);
      if (!source) {
        return {
          content: [{ type: 'text', text: 'Missing source. Provide a Git URL, archive URL, file URL, or local path.' }],
          details: { errorCode: 'missing_source' },
        };
      }

      try {
        const result = await deps.installSkillFromSource({
          source,
          ref: clean(params.ref),
          path: clean(params.path),
          skillId: clean(params.skillId),
          target,
          sessionKey,
          force: params.force === true,
          strictScan: params.strictScan === true,
        });
        return {
          content: [
            {
              type: 'text',
              text: [
                `Installed skill "${result.skillId}".`,
                `Target: ${result.target ?? target}`,
                `Source: ${result.source} (${result.kind})`,
                `Path: ${result.path}`,
                `Tree hash: ${result.contentHash.slice(0, 16)}`,
              ].join('\n'),
            },
          ],
          details: { result },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Skill install failed: ${message}` }],
          details: { errorCode: 'install_failed', errorMessage: message },
        };
      }
    },
    mutatesWorkspace: true,
    mutationScope: 'unknown',
    idempotent: false,
    finalGuardRelevant: true,
  } as any;
}
