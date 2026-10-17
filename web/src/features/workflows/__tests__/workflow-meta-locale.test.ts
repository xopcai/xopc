import { describe, expect, it } from 'vitest';

import { BUILTIN_WORKFLOWS } from '../../../../../src/agent/workflow/builtins/index';
import type { WorkflowDefinition } from '../workflow-api';
import { resolveWorkflowLocalizedCopy } from '../workflow-meta-locale';
import { filterDefinitions } from '../workflow-page.utils';
import { parseWorkflowSourceDocument, serializeWorkflowSourceDocument, workflowDefinitionToSourceDocument } from '../workflow-source';

const audit = BUILTIN_WORKFLOWS.find((definition) => definition.name === 'audit_repo')!;

function withLocales(i18n: WorkflowDefinition['metadata']['i18n']): WorkflowDefinition {
  return { ...audit, metadata: { ...audit.metadata, i18n } };
}

describe('workflow localized copy', () => {
  it('ships English and Chinese titles, descriptions and usage guidance for all 16 builtins', () => {
    expect(BUILTIN_WORKFLOWS).toHaveLength(16);
    for (const definition of BUILTIN_WORKFLOWS) {
      const en = resolveWorkflowLocalizedCopy(definition, 'en');
      const zh = resolveWorkflowLocalizedCopy(definition, 'zh');
      expect(en.title).toMatch(/[a-z]/i);
      expect(en.description).toMatch(/[a-z]/i);
      expect(en.whenToUse).toBeTruthy();
      expect(zh.title).toMatch(/[\u4e00-\u9fff]/);
      expect(zh.description).toMatch(/[\u4e00-\u9fff]/);
      expect(zh.whenToUse).toMatch(/[\u4e00-\u9fff]/);
      expect(definition.id).toBe(definition.name);
      for (const query of [definition.name, en.title.toUpperCase(), en.description, zh.title, zh.description]) {
        expect(filterDefinitions([...BUILTIN_WORKFLOWS], query, 'all', 'all')).toContain(definition);
      }
    }
  });

  it('falls back to default copy for legacy definitions without translations', () => {
    const definition = withLocales(undefined);
    expect(resolveWorkflowLocalizedCopy(definition, 'zh')).toEqual(resolveWorkflowLocalizedCopy(definition, 'en'));
    expect(resolveWorkflowLocalizedCopy(definition, undefined).title).toBe(audit.title);
  });

  it('falls back independently for blank or missing translated fields', () => {
    const definition = withLocales({ zh: { title: '  ', description: ' 中文简介 ', whenToUse: '\n' } });
    expect(resolveWorkflowLocalizedCopy(definition, 'zh')).toMatchObject({
      title: audit.title,
      description: '中文简介',
      whenToUse: audit.metadata.whenToUse,
    });
    expect(resolveWorkflowLocalizedCopy(withLocales({ zh: { title: '中文名称' } }), 'zh')).toMatchObject({
      title: '中文名称', description: audit.description,
    });
  });

  it('honors explicit English translations for workflows with another default language', () => {
    const definition = withLocales({ en: { title: ' English title ', description: 'English description' } });
    expect(resolveWorkflowLocalizedCopy(definition, 'en')).toMatchObject({ title: 'English title', description: 'English description' });
  });

  it('preserves localized example prompts and their fallback', () => {
    const definition = withLocales({ zh: { examplePrompts: [{ field: 'goal', text: '检查仓库' }] } });
    definition.metadata.examplePrompts = [{ field: 'goal', text: 'Check repository' }];
    expect(resolveWorkflowLocalizedCopy(definition, 'zh').examplePrompts[0].text).toBe('检查仓库');
    definition.metadata.i18n!.zh.examplePrompts = [];
    expect(resolveWorkflowLocalizedCopy(definition, 'zh').examplePrompts[0].text).toBe('Check repository');
  });

  it('retains default and translated copy through source export and import', () => {
    const result = parseWorkflowSourceDocument(serializeWorkflowSourceDocument(workflowDefinitionToSourceDocument(audit)));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.document.manifest.title).toBe(audit.title);
    expect(result.document.manifest.i18n).toEqual(audit.metadata.i18n);
  });
});
