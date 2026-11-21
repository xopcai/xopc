import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const skillName = 'verify-tabular-delivery';

export function loadHarnessTreatment(path: string) {
  const bytes = readFileSync(path);
  const treatment = JSON.parse(bytes.toString('utf8')) as { guidance?: string; skill?: string };
  if (!treatment || Object.keys(treatment).some(key => key !== 'guidance' && key !== 'skill')
    || Object.values(treatment).some(value => typeof value !== 'string' || !value.trim() || value.length > 4000)
    || (!treatment.guidance && !treatment.skill)) {
    throw new Error('Expected at least one bounded guidance or Skill change');
  }
  return { ...treatment, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function installHarnessTreatment(
  treatment: ReturnType<typeof loadHarnessTreatment>,
  stateRoot: string,
  workspace: string,
) {
  if (treatment.guidance) {
    const profile = join(stateRoot, 'agents', 'data-analyst', 'profile');
    mkdirSync(profile, { recursive: true });
    appendFileSync(join(profile, 'AGENTS.md'), `\n\n## File delivery verification\n\n${treatment.guidance.trim()}\n`);
  }

  if (treatment.skill) {
    const skill = join(workspace, '.xopc', 'skills', skillName);
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'),
      `---\nname: ${skillName}\ndescription: Verify a requested tabular artifact and its report against the input data before final publication or after file recovery.\n---\n\n${treatment.skill.trim()}\n`,
      { flag: 'wx' });
  }
}
