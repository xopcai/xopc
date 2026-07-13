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

export interface SkillInstallToolDeps {
  installSkillFromSource?: (opts: SkillInstallToolOptions) => Promise<SkillInstallToolResult>;
  getSessionKey?: () => string | undefined;
}

const SkillInstallSchema = Type.Object({
  source: Type.String({
    description:
      'Explicit skill source: Git URL, GitHub repository URL, https .zip/.tar.gz URL, file:// URL, or local archive/path.',
  }),
  ref: Type.Optional(Type.String({ description: 'Optional Git branch/tag/ref.' })),
  path: Type.Optional(
    Type.String({ description: 'Optional subdirectory inside the source that contains SKILL.md.' }),
  ),
  skillId: Type.Optional(
    Type.String({ description: 'Optional target managed skill id under the current workspace .xopc/skills.' }),
  ),
  target: Type.Optional(
    Type.Union([
      Type.Literal('workspace'),
      Type.Literal('global'),
    ], {
      description:
        'Install target. Defaults to workspace. Use global only when the user explicitly asks for a global/personal install.',
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
      'Install an xopc skill from an explicit user-provided source. Use only when the user clearly asks to install or update a skill; do not install from a URL the user merely pasted without installation intent.',
    parameters: SkillInstallSchema,
    async execute(_toolCallId: string, params: any): Promise<AgentToolResult<{}>> {
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
          target: isSkillInstallTarget(params.target) ? params.target : undefined,
          sessionKey: deps.getSessionKey?.(),
          force: params.force === true,
          strictScan: params.strictScan === true,
        });
        return {
          content: [
            {
              type: 'text',
              text: [
                `Installed skill "${result.skillId}".`,
                `Target: ${result.target ?? 'workspace'}`,
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
  } as any;
}
