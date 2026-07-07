import { readFileSync, statSync } from 'fs';
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import { resolveStateDir } from '../../config/paths.js';
import { createSkillConfigManager, isSkillEnabled, resolveSkillConfig } from '../skills/config.js';
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
  /** Register declared env var names for command/tool passthrough (values never exposed). */
  registerSkillEnvPassthrough?: (names: string[]) => void;
}

function maxSkillBytes(): number {
  const lim = createSkillConfigManager(resolveStateDir()).load().limits?.maxSkillFileBytes;
  return typeof lim === 'number' && lim > 0 ? lim : DEFAULT_MAX_SKILL_FILE_BYTES;
}

export function createSkillsListTool(deps: SkillsToolsDeps): AgentTool {
  return {
    name: 'skills_list',
    label: '📚 Skills',
    description:
      'List available skills (name and description only). Use skill_view(name) to load SKILL.md or a file under references/, templates/, scripts/, or assets/.',
    parameters: SkillsListSchema,
    async execute(
      _toolCallId: string,
      params: any,
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
      const q = (params as { query?: string }).query?.trim().toLowerCase();
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
  } as any;
}

export function createSkillViewTool(deps: SkillsToolsDeps): AgentTool {
  return {
    name: 'skill_view',
    label: '📖 Skill',
    description:
      'Load a skill\'s SKILL.md (default) or a supporting file under references/, templates/, scripts/, or assets/.',
    parameters: SkillViewSchema,
    async execute(
      _toolCallId: string,
      params: any,
    ): Promise<AgentToolResult<{}>> {
      const p = params as { name: string; path?: string; limit?: number };
      const mgr = deps.getSkillManager();
      if (!mgr) {
        return {
          content: [{ type: 'text', text: 'Skills are not available in this runtime context.' }],
          details: {},
        };
      }

      const skill = mgr.findSkill(p.name.trim());
      if (!skill) {
        return {
          content: [
            {
              type: 'text',
              text: `Skill "${p.name}" was not found. It may not be installed. Open the Skills library to install it, or use skills_list to see available names.`,
            },
          ],
          details: { errorCode: 'skill_not_found', skillName: p.name },
        };
      }

      const skillsConfig = createSkillConfigManager(resolveStateDir()).load();
      const skillConfig = resolveSkillConfig(skill, skillsConfig);
      if (skillConfig.enabled === false) {
        return {
          content: [
            {
              type: 'text',
              text: `Skill "${skill.name}" is installed but disabled. Enable it in Skills settings before using it.`,
            },
          ],
          details: { errorCode: 'skill_disabled', skillName: skill.name },
        };
      }
      if (skill.disableModelInvocation) {
        return {
          content: [{ type: 'text', text: `Skill "${skill.name}" is installed, but it is not available for model invocation.` }],
          details: { errorCode: 'skill_model_invocation_disabled', skillName: skill.name },
        };
      }
      if (!isSkillEnabled(skill, skillsConfig)) {
        return {
          content: [{ type: 'text', text: `Skill "${skill.name}" is installed, but its requirements are not met.` }],
          details: { errorCode: 'skill_requirements_unmet', skillName: skill.name },
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
              text: `The current agent cannot use skill "${skill.name}". It is installed, but it is not in this agent's skill allowlist or is hidden by tool gating. Enable it in Agent settings → Skills before using it.`,
            },
          ],
          details: { errorCode: 'skill_agent_denied', skillName: skill.name },
        };
      }

      const resolved = resolveSkillReadablePath(skill, p.path);
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
          maxLines: p.limit ?? DEFAULT_MAX_LINES,
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
  } as any;
}
