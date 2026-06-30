import type { EffectiveAgentManifest } from './schema.js';

function listBlock(items: readonly string[] | undefined): string {
  return (items ?? []).map((item) => `- ${item}`).join('\n');
}

function toolPolicySummary(manifest: EffectiveAgentManifest): string {
  const rows = Object.entries(manifest.tools.builtin)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, policy]) => {
      const scope = policy.scope ? `, scope=${policy.scope}` : '';
      return `- ${name}: ${policy.mode}${scope}`;
    });
  return rows.length > 0 ? rows.join('\n') : '- No built-in tools declared';
}

function memorySummary(manifest: EffectiveAgentManifest): string {
  return [
    `Mode: ${manifest.memory.mode}`,
    `Sources: ${manifest.memory.sources.join(', ') || 'none'}`,
  ].join('\n');
}

export function buildAgentManifestPromptSection(manifest: EffectiveAgentManifest): string {
  const sections = [
    `<agent_identity>
Name: ${manifest.identity.name}
Role: ${manifest.identity.role}
Language: ${manifest.identity.language}
Tone: ${manifest.identity.tone}
</agent_identity>`,
    `<responsibilities>
Primary:
${listBlock(manifest.responsibilities.primary)}
${manifest.responsibilities.secondary?.length ? `Secondary:\n${listBlock(manifest.responsibilities.secondary)}` : ''}
${manifest.responsibilities.outOfScope?.length ? `Out of scope:\n${listBlock(manifest.responsibilities.outOfScope)}` : ''}
</responsibilities>`,
    `<boundaries>
Requires confirmation:
${listBlock(manifest.boundaries.requiresConfirmation)}
Forbidden:
${listBlock(manifest.boundaries.forbidden)}
Escalation:
${listBlock(manifest.boundaries.escalation)}
</boundaries>`,
    `<tool_policy>
${toolPolicySummary(manifest)}
</tool_policy>`,
    `<memory_policy>
${memorySummary(manifest)}
</memory_policy>`,
  ];

  if (manifest.workflows.default || manifest.workflows.allowed?.length) {
    sections.push(`<workflow_policy>
Default: ${manifest.workflows.default ?? 'none'}
Allowed:
${listBlock(manifest.workflows.allowed)}
</workflow_policy>`);
  }

  if (manifest.prompt?.customInstructions?.trim()) {
    sections.push(`<custom_instructions>
${manifest.prompt.customInstructions.trim()}
</custom_instructions>`);
  }

  return sections.join('\n\n');
}
