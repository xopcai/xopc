import { describe, expect, it } from 'vitest';

import { workflowResultToMarkdown } from '../workflow-result-markdown';

describe('workflowResultToMarkdown', () => {
  it('preserves summary Markdown and renders structured sections', () => {
    expect(workflowResultToMarkdown({
      summary: '# Report\n\nThe workflow **completed**.',
      sections: [
        { kind: 'text', title: 'Details', content: '- First\n- Second' },
        { kind: 'questions', title: 'Next steps', items: ['Review the output'] },
        {
          kind: 'findings',
          title: 'Findings',
          items: [{ title: 'Issue', severity: 'high', file: 'src/app.ts', line: 7, detail: 'Details' }],
        },
      ],
    })).toBe([
      '# Report\n\nThe workflow **completed**.',
      '## Details\n\n- First\n- Second',
      '## Next steps\n- Review the output',
      '## Findings\n\n### Issue\n\n**Severity:** high\n\n**Location:** `src/app.ts:7`\n\nDetails',
    ].join('\n\n'));
  });
});
