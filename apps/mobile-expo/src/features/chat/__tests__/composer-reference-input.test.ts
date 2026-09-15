import { describe, expect, it } from 'vitest';
import { prepareComposerInput } from '../composer-send-helpers';

describe('workspace file selection', () => {
  it('routes workspace-only files through mentions and preserves upload attachments', () => {
    const upload = { type: 'document', uri: 'media://upload/1', name: 'Upload' };
    const input = prepareComposerInput('Compare', [
      { type: 'document', workspaceRelativePath: 'plans/launch plan.md' },
      { type: 'document', workspaceRelativePath: 'plans/launch plan.md' }, upload,
    ]);
    expect(input).toEqual({ text: 'Compare\n@file:"plans/launch plan.md"', attachments: [upload] });
  });
});
