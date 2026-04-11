import { readFileSync, statSync } from 'fs';
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

import { resolveStateDir } from '../../config/paths.js';
import { createSkillConfigManager, isSkillEnabled } from '../skills/config.js';
import { resolveSkillReadablePath } from '../skills/skill-view-path.js';
import type { SkillManager } from '../skills/skill-manager.js';
import { truncateHead, formatSize, DEFAULT_MAX_BYTES } from './truncate.js';

const DEFAULT_MAX_LINES = 500;
const DEFAULT_MAX_SKILL_FILE_BYTES = 1_048_576;

const SkillsListSchema = Type.Object({
  query: Type.Optional(
    Type.String({
      description: 'Optional case-insensitive substring filter on skill name and description',
    }),
  ),
});

const SkillViewSchema = Type.Object({
  name: Type.String({ description: 'Skill name (as in <available_skills> / skills_list)' }),
  path: Type.Optional(
    Type.String({
      description:
        'Relative path inside the skill dir: omit for SKILL.md, or e.g. references/doc.md (only references/, templates/, scripts/, assets/)',
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: 'Max lines to return (default 500, like read_file)' }),
  ),
});

export interface SkillsToolsDeps {
  getSkillManager: () => SkillManager | undefined;
  getSkillIndexingContext?: () =>
    | { registeredToolNames: string[]; skillAllowlist?: string[] }
    | undefined;
  /** Register declared env var names for shell / tool passthrough (values never exposed). */
  registerSkillEnvPassthrough?: (names: string[]) => void;
}

function maxSkillBytes(): number {
  const lim = createSkillConfigManager(resolveStateDir()).load().limits?.maxSkillFileBytes;
  return typeof lim === 'number' && lim > 0 ? lim : DEFAULT_MAX_SKILL_FILE_BYTES;
}

export function createSkillsListTool(deps: SkillsToolsDeps): AgentTool<typeof SkillsListSchema, {}> {
  return {
    name: 'skills_list',
    label: '📚 Skills',
    description:
      'List available skills (name and description only). Use skill_view(name) to load SKILL.md or a file under references/, templates/, scripts/, or assets/.',
    parameters: SkillsListSchema,
    async execute(
      _toolCallId: string,
      params: Static<typeof SkillsListSchema>,
    ): Promise<AgentToolResult<{}>> {
      const mgr = deps.getSkillManager();
      if (!mgr) {
        return {
          content: [{ type: 'text', text: 'Skills are not available in this runtime context.' }],
          details: {},
        };
      }

      const idx = deps.getSkillIndexingContext?.();
      let skills = mgr.getEnabledSkillsForAgentSession({
        skillAllowlist: idx?.skillAllowlist,
        registeredToolNames: idx?.registeredToolNames,
      });
      const q = params.query?.trim().toLowerCase();
      if (q) {
        skills = skills.filter(
          (s) =>
            s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
        );
      }

      const payload = {
        skills: skills.map((s) => ({
          name: s.name,
          description: s.description,
          source: s.source,
        })),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        details: {},
      };
    },
  };
}

export function createSkillViewTool(deps: SkillsToolsDeps): AgentTool<typeof SkillViewSchema, {}> {
  return {
    name: 'skill_view',
    label: '📖 Skill',
    description:
      'Load a skill\'s SKILL.md (default) or a supporting file under references/, templates/, scripts/, or assets/.',
    parameters: SkillViewSchema,
    async execute(
      _toolCallId: string,
      params: Static<typeof SkillViewSchema>,
    ): Promise<AgentToolResult<{}>> {
      const mgr = deps.getSkillManager();
      if (!mgr) {
        return {
          content: [{ type: 'text', text: 'Skills are not available in this runtime context.' }],
          details: {},
        };
      }

      const skill = mgr.findSkill(params.name.trim());
      if (!skill) {
        return {
          content: [
            {
              type: 'text',
              text: `Skill not found: "${params.name}". Use skills_list to see available names.`,
            },
          ],
          details: {},
        };
      }

      const skillsConfig = createSkillConfigManager(resolveStateDir()).load();
      if (skill.disableModelInvocation || !isSkillEnabled(skill, skillsConfig)) {
        return {
          content: [{ type: 'text', text: `Skill "${skill.name}" is disabled or requirements are not met.` }],
          details: {},
        };
      }

      const idx = deps.getSkillIndexingContext?.();
      const visible = mgr.getEnabledSkillsForAgentSession({
        skillAllowlist: idx?.skillAllowlist,
        registeredToolNames: idx?.registeredToolNames,
      });
      if (!visible.some((s) => s.name === skill.name)) {
        return {
          content: [
            {
              type: 'text',
              text: `Skill "${skill.name}" is not available in this session (tool gating or allowlist).`,
            },
          ],
          details: {},
        };
      }

      const resolved = resolveSkillReadablePath(skill, params.path);
      if (resolved.ok === false) {
        return { content: [{ type: 'text', text: resolved.error }], details: {} };
      }

      const maxBytes = maxSkillBytes();
      try {
        const st = statSync(resolved.absolutePath);
        if (st.size > maxBytes) {
          return {
            content: [
              {
                type: 'text',
                text: `File too large: ${formatSize(st.size)} (limit ${formatSize(maxBytes)})`,
              },
            ],
            details: {},
          };
        }

        const raw = readFileSync(resolved.absolutePath, 'utf-8');
        const truncation = truncateHead(raw, {
          maxLines: params.limit ?? DEFAULT_MAX_LINES,
          maxBytes: DEFAULT_MAX_BYTES,
        });

        let outputText = truncation.content;
        if (truncation.truncated) {
          if (truncation.firstLineExceedsLimit) {
            outputText = `(Line exceeds ${formatSize(DEFAULT_MAX_BYTES)})`;
          } else {
            outputText += `\n\n[${truncation.outputLines}/${truncation.totalLines} lines]`;
          }
        }

        const envNames = skill.requiredEnvVarNames;
        if (envNames?.length && deps.registerSkillEnvPassthrough) {
          deps.registerSkillEnvPassthrough(envNames);
          const setNow = envNames.filter((k) => process.env[k] !== undefined).length;
          outputText += `\n\n[skill env passthrough] Registered ${envNames.length} declared variable name(s) for this session; ${setNow} are currently defined in the process (values are never shown).`;
        }

        return { content: [{ type: 'text', text: outputText }], details: {} };
      } catch (e) {
        return {
          content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          details: {},
        };
      }
    },
  };
}
