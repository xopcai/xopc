import type { WorkflowResult } from '../../query/workflows';

export function workflowResultToMarkdown(result: WorkflowResult): string {
  const blocks = [result.summary.trim()];
  for (const section of result.sections ?? []) {
    const heading = section.title.trim() ? `## ${section.title.trim()}` : '';
    if (section.kind === 'text') {
      blocks.push([heading, section.content.trim()].filter(Boolean).join('\n\n'));
      continue;
    }
    if (section.kind === 'questions') {
      blocks.push([heading, ...section.items.map((item) => `- ${item}`)].filter(Boolean).join('\n'));
      continue;
    }
    if (section.kind === 'findings') {
      blocks.push([
        heading,
        ...section.items.map((item) => [
          `### ${item.title}`,
          item.severity ? `**Severity:** ${item.severity}` : '',
          item.file ? `**Location:** \`${item.file}${item.line == null ? '' : `:${item.line}`}\`` : '',
          item.detail ?? '',
          item.recommendation ?? '',
        ].filter(Boolean).join('\n\n')),
      ].filter(Boolean).join('\n\n'));
      continue;
    }
    blocks.push([
      heading,
      ...section.items.map((item) => [
        `### ${item.title}`,
        item.severity ? `**Severity:** ${item.severity}` : '',
        item.impact ?? '',
        item.mitigation ?? '',
      ].filter(Boolean).join('\n\n')),
    ].filter(Boolean).join('\n\n'));
  }
  return blocks.filter(Boolean).join('\n\n');
}
