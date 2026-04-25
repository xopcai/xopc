import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { readFile, rm } from 'fs/promises';

import { resolveStateDir } from '../../config/paths.js';
import { createSkillConfigManager } from '../skills/config.js';
import type { SkillManager } from '../skills/skill-manager.js';
import {
  applyPatchToContent,
  atomicWriteUtf8,
  effectiveAgentWritePolicy,
  ensureCategorySegment,
  maxSkillMdChars,
  maxSupportFileBytes,
  mutatableSkillOrNull,
  isPathInsideDir,
  resolveCreateSkillDir,
  scanSkillDirOrError,
  validateSkillMdContent,
  validateSkillNameSegment,
  validateSupportingRelativePath,
} from '../skills/skill-manage-ops.js';

const SkillManageSchema = Type.Object({
  action: Type.Union([
    Type.Literal('create'),
    Type.Literal('edit'),
    Type.Literal('patch'),
    Type.Literal('delete'),
    Type.Literal('write_file'),
    Type.Literal('remove_file'),
  ]),
  name: Type.Optional(Type.String({ description: 'Skill name (directory id / frontmatter name)' })),
  content: Type.Optional(Type.String({ description: 'Full SKILL.md for create or edit' })),
  category: Type.Optional(Type.String({ description: 'Optional single-segment category folder under skills root' })),
  write_target: Type.Optional(
    Type.Union([Type.Literal('global'), Type.Literal('workspace')], {
      description: 'Where to create the skill (default global). Respects skills.agentWritePolicy.',
    }),
  ),
  old_string: Type.Optional(Type.String()),
  new_string: Type.Optional(Type.String()),
  replace_all: Type.Optional(Type.Boolean({ default: false })),
  file_path: Type.Optional(
    Type.String({
      description: 'Relative path under skill dir (references/, templates/, scripts/, assets/)',
    }),
  ),
  file_content: Type.Optional(Type.String({ description: 'For write_file' })),
});

export interface SkillManageToolDeps {
  getSkillManager: () => SkillManager | undefined;
  getWorkspace: () => string;
  onSkillsFilesystemMutate?: () => void;
}

function jsonResult(obj: Record<string, unknown>): AgentToolResult<{}> {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }], details: {} };
}

export function createSkillManageTool(deps: SkillManageToolDeps): AgentTool {
  return {
    name: 'skill_manage',
    label: '🛠️ Skill',
    description:
      'Create, edit, patch, or delete user skills under ~/.xopc/skills and/or workspace skills/ (see skills.agentWritePolicy). ' +
      'Also write_file / remove_file under references/, templates/, scripts/, assets/. ' +
      'Bundled and extra-dir skills cannot be modified. Runs a security scan after writes.',
    parameters: SkillManageSchema,
    async execute(
      _toolCallId: string,
      params: Static<typeof SkillManageSchema>,
    ): Promise<AgentToolResult<{}>> {
      const mgr = deps.getSkillManager();
      if (!mgr) {
        return jsonResult({ success: false, error: 'Skill manager not available in this context.' });
      }

      const workspace = deps.getWorkspace();
      const skillsCfg = createSkillConfigManager(resolveStateDir()).load();
      const policy = effectiveAgentWritePolicy(skillsCfg);
      const mdMax = maxSkillMdChars(skillsCfg);
      const supMax = maxSupportFileBytes(skillsCfg);

      const notify = () => deps.onSkillsFilesystemMutate?.();

      try {
        switch (params.action) {
          case 'create': {
            const nameErr = validateSkillNameSegment(params.name ?? '', 'name');
            if (nameErr) return jsonResult({ success: false, error: nameErr });
            const name = params.name!.trim();

            const catErr = ensureCategorySegment(params.category);
            if (catErr) return jsonResult({ success: false, error: catErr });

            const md = validateSkillMdContent(params.content ?? '', name, mdMax);
            if (md.ok === false) return jsonResult({ success: false, error: md.error });

            if (mgr.hasSkill(name)) {
              return jsonResult({
                success: false,
                error: `A skill named "${name}" already exists. Use edit or choose another name.`,
              });
            }

            const target = params.write_target ?? 'global';
            const dirRes = resolveCreateSkillDir(name, params.category?.trim(), target, workspace, policy);
            if (dirRes.ok === false) return jsonResult({ success: false, error: dirRes.error });

            if (existsSync(dirRes.dir)) {
              return jsonResult({ success: false, error: `Directory already exists: ${dirRes.dir}` });
            }

            const skillMdPath = join(dirRes.dir, 'SKILL.md');
            try {
              await atomicWriteUtf8(skillMdPath, params.content!);
              const scanErr = await scanSkillDirOrError(dirRes.dir, name);
              if (scanErr) {
                rmSync(dirRes.dir, { recursive: true, force: true });
                return jsonResult({ success: false, error: scanErr });
              }
            } catch (e) {
              rmSync(dirRes.dir, { recursive: true, force: true });
              throw e;
            }

            notify();
            return jsonResult({
              success: true,
              message: `Skill "${name}" created.`,
              path: dirRes.dir,
            });
          }

          case 'edit': {
            const nameErr = validateSkillNameSegment(params.name ?? '', 'name');
            if (nameErr) return jsonResult({ success: false, error: nameErr });
            const name = params.name!.trim();

            const sk = mutatableSkillOrNull(mgr.findSkill(name), workspace, policy);
            if (!sk) {
              return jsonResult({
                success: false,
                error: `Skill "${name}" not found or not writable (bundled/extra or policy).`,
              });
            }

            const md = validateSkillMdContent(params.content ?? '', name, mdMax);
            if (md.ok === false) return jsonResult({ success: false, error: md.error });

            const skillMdPath = join(sk.baseDir, 'SKILL.md');
            let previous: string;
            try {
              previous = await readFile(skillMdPath, 'utf-8');
            } catch {
              return jsonResult({ success: false, error: 'SKILL.md could not be read.' });
            }

            try {
              await atomicWriteUtf8(skillMdPath, params.content!);
              const scanErr = await scanSkillDirOrError(sk.baseDir, name);
              if (scanErr) {
                await atomicWriteUtf8(skillMdPath, previous);
                return jsonResult({ success: false, error: scanErr });
              }
            } catch (e) {
              await atomicWriteUtf8(skillMdPath, previous).catch(() => {});
              throw e;
            }

            notify();
            return jsonResult({ success: true, message: `Skill "${name}" updated.`, path: sk.baseDir });
          }

          case 'patch': {
            const nameErr = validateSkillNameSegment(params.name ?? '', 'name');
            if (nameErr) return jsonResult({ success: false, error: nameErr });
            const name = params.name!.trim();

            const sk = mutatableSkillOrNull(mgr.findSkill(name), workspace, policy);
            if (!sk) {
              return jsonResult({
                success: false,
                error: `Skill "${name}" not found or not writable.`,
              });
            }

            let relPath: string | undefined;
            if (params.file_path?.trim()) {
              const pErr = validateSupportingRelativePath(params.file_path.trim());
              if (pErr) return jsonResult({ success: false, error: pErr });
              relPath = params.file_path.trim().replace(/\\/g, '/');
            }

            const targetPath = relPath ? join(sk.baseDir, relPath) : join(sk.baseDir, 'SKILL.md');
            if (!isPathInsideDir(sk.baseDir, targetPath)) {
              return jsonResult({ success: false, error: 'Resolved path escapes skill directory.' });
            }

            let previous: string;
            try {
              previous = await readFile(targetPath, 'utf-8');
            } catch {
              return jsonResult({ success: false, error: `File not found: ${relPath ?? 'SKILL.md'}` });
            }

            const patched = applyPatchToContent(
              previous,
              params.old_string ?? '',
              params.new_string ?? '',
              params.replace_all === true,
            );
            if (patched.ok === false) return jsonResult({ success: false, error: patched.error });

            if (!relPath) {
              const md = validateSkillMdContent(patched.next, name, mdMax);
              if (md.ok === false) return jsonResult({ success: false, error: `Patch rejected: ${md.error}` });
            } else if (Buffer.byteLength(patched.next, 'utf-8') > supMax) {
              return jsonResult({ success: false, error: `File exceeds size limit (${supMax} bytes).` });
            }

            try {
              await atomicWriteUtf8(targetPath, patched.next);
              const scanErr = await scanSkillDirOrError(sk.baseDir, name);
              if (scanErr) {
                await atomicWriteUtf8(targetPath, previous);
                return jsonResult({ success: false, error: scanErr });
              }
            } catch (e) {
              await atomicWriteUtf8(targetPath, previous).catch(() => {});
              throw e;
            }

            notify();
            return jsonResult({
              success: true,
              message: `Patched ${relPath ?? 'SKILL.md'} (${patched.replacements} replacement(s)).`,
            });
          }

          case 'delete': {
            const nameErr = validateSkillNameSegment(params.name ?? '', 'name');
            if (nameErr) return jsonResult({ success: false, error: nameErr });
            const name = params.name!.trim();

            const sk = mutatableSkillOrNull(mgr.findSkill(name), workspace, policy);
            if (!sk) {
              return jsonResult({
                success: false,
                error: `Skill "${name}" not found or not writable.`,
              });
            }

            rmSync(sk.baseDir, { recursive: true, force: true });
            notify();
            return jsonResult({ success: true, message: `Skill "${name}" removed.`, path: sk.baseDir });
          }

          case 'write_file': {
            const nameErr = validateSkillNameSegment(params.name ?? '', 'name');
            if (nameErr) return jsonResult({ success: false, error: nameErr });
            const name = params.name!.trim();

            const sk = mutatableSkillOrNull(mgr.findSkill(name), workspace, policy);
            if (!sk) {
              return jsonResult({
                success: false,
                error: `Skill "${name}" not found or not writable.`,
              });
            }

            const pErr = validateSupportingRelativePath(params.file_path ?? '');
            if (pErr) return jsonResult({ success: false, error: pErr });
            const rel = params.file_path!.trim().replace(/\\/g, '/');
            const targetPath = join(sk.baseDir, rel);
            if (!isPathInsideDir(sk.baseDir, targetPath)) {
              return jsonResult({ success: false, error: 'Resolved path escapes skill directory.' });
            }

            const body = params.file_content ?? '';
            if (Buffer.byteLength(body, 'utf-8') > supMax) {
              return jsonResult({ success: false, error: `File exceeds size limit (${supMax} bytes).` });
            }

            const existed = existsSync(targetPath);
            let previous: string | null = null;
            if (existed) {
              try {
                previous = await readFile(targetPath, 'utf-8');
              } catch {
                previous = null;
              }
            }

            try {
              await atomicWriteUtf8(targetPath, body);
              const scanErr = await scanSkillDirOrError(sk.baseDir, name);
              if (scanErr) {
                if (previous !== null) await atomicWriteUtf8(targetPath, previous);
                else await rm(targetPath, { force: true });
                return jsonResult({ success: false, error: scanErr });
              }
            } catch (e) {
              if (previous !== null) await atomicWriteUtf8(targetPath, previous).catch(() => {});
              else await rm(targetPath, { force: true }).catch(() => {});
              throw e;
            }

            notify();
            return jsonResult({
              success: true,
              message: `Wrote ${rel}.`,
            });
          }

          case 'remove_file': {
            const nameErr = validateSkillNameSegment(params.name ?? '', 'name');
            if (nameErr) return jsonResult({ success: false, error: nameErr });
            const name = params.name!.trim();

            const sk = mutatableSkillOrNull(mgr.findSkill(name), workspace, policy);
            if (!sk) {
              return jsonResult({
                success: false,
                error: `Skill "${name}" not found or not writable.`,
              });
            }

            const pErr = validateSupportingRelativePath(params.file_path ?? '');
            if (pErr) return jsonResult({ success: false, error: pErr });
            const rel = params.file_path!.trim().replace(/\\/g, '/');
            const targetPath = join(sk.baseDir, rel);
            if (!isPathInsideDir(sk.baseDir, targetPath)) {
              return jsonResult({ success: false, error: 'Resolved path escapes skill directory.' });
            }

            if (!existsSync(targetPath)) {
              return jsonResult({ success: false, error: `File not found: ${rel}` });
            }

            await rm(targetPath, { force: true });
            await scanSkillDirOrError(sk.baseDir, name);
            notify();
            return jsonResult({ success: true, message: `Removed ${rel}.` });
          }

          default:
            return jsonResult({ success: false, error: 'Unknown action.' });
        }
      } catch (e) {
        return jsonResult({
          success: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
  } as any;
}
