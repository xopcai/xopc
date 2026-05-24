import { resolveBundledSkillsDir, resolveStateDir } from '../../config/paths.js';
import { getWorkspacePath, loadConfig } from '../../config/index.js';
import { loadSkills } from '../../agent/skills/index.js';
import type { TuiAutocompleteProvider } from '../../extensions/types/tui.js';

/** `@skill` autocomplete from workspace + global + bundled skill directories. */
export function createSkillsAutocompleteProvider(): TuiAutocompleteProvider {
  let cached: Array<{ name: string; description?: string }> | null = null;

  const refresh = () => {
    const config = loadConfig();
    const workspaceDir = getWorkspacePath(config);
    const result = loadSkills({
      workspaceDir,
      builtinDir: resolveBundledSkillsDir(),
      globalDir: resolveStateDir(),
    });
    cached = result.skills.map((skill) => ({
      name: skill.name,
      description: skill.description?.slice(0, 120),
    }));
  };

  return (query) => {
    if (!cached) refresh();
    const skills = cached ?? [];
    const q = query.toLowerCase();
    const filtered = q
      ? skills.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.description?.toLowerCase().includes(q) ?? false),
        )
      : skills;
    return filtered.slice(0, 30);
  };
}

/** Test helper — build skill list without caching. */
export function listSkillAutocompleteSuggestions(): Array<{ name: string; description?: string }> {
  const config = loadConfig();
  const result = loadSkills({
    workspaceDir: getWorkspacePath(config),
    builtinDir: resolveBundledSkillsDir(),
    globalDir: resolveStateDir(),
  });
  return result.skills.map((s) => ({
    name: s.name,
    description: s.description,
  }));
}
