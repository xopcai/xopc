import { describe, it, expect } from 'vitest';

import { parseBrowserPipeline } from '../pipeline/schema.js';
import { resolveTemplate, resolveTemplateDeep } from '../pipeline/template.js';
import { runBrowserPipeline, validateBrowserPipeline } from '../pipeline/runner.js';
import { createBrowserActionRegistry } from '../actions/registry.js';
import type { BrowserActionContext } from '../actions/types.js';

describe('Pipeline YAML parsing', () => {
  it('parses a valid pipeline document', () => {
    const yaml = `
apiVersion: xopc.ai/browser-recipe/v1
id: test-pipeline
name: test-pipeline
description: A test pipeline
risk: read_only
domains: [example.com]
args:
  url:
    type: string
    required: true
  query:
    type: string
    default: hello
pipeline:
  - navigate:
      url: https://example.com
  - wait:
      selector: body
  - screenshot:
      full_page: true
on_error:
  - screenshot:
      path: ./error.png
`;
    const result = parseBrowserPipeline(yaml);
    expect(result.ok).toBe(true);
    expect(result.document).toBeDefined();
    expect(result.document!.name).toBe('test-pipeline');
    expect(result.document!.description).toBe('A test pipeline');
    expect(result.document!.pipeline).toHaveLength(3);
    expect(result.document!.onError).toHaveLength(1);
    expect(result.document!.args.url.required).toBe(true);
    expect(result.document!.args.query.default).toBe('hello');
  });

  it('rejects YAML without name', () => {
    const yaml = `
apiVersion: xopc.ai/browser-recipe/v1
id: missing-name
risk: read_only
domains: [example.com]
pipeline:
  - navigate:
      url: https://example.com
`;
    const result = parseBrowserPipeline(yaml);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === 'name')).toBe(true);
  });

  it('rejects YAML without pipeline array', () => {
    const yaml = `
apiVersion: xopc.ai/browser-recipe/v1
id: bad
name: bad
risk: read_only
domains: [example.com]
pipeline: not-an-array
`;
    const result = parseBrowserPipeline(yaml);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === 'pipeline')).toBe(true);
  });

  it('rejects steps with multiple actions', () => {
    const yaml = `
apiVersion: xopc.ai/browser-recipe/v1
id: multi-action
name: multi-action
risk: read_only
domains: [example.com]
pipeline:
  - navigate:
      url: https://example.com
    wait:
      selector: body
`;
    const result = parseBrowserPipeline(yaml);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes('exactly one action'))).toBe(true);
  });

  it('rejects scalar action shorthand', () => {
    const yaml = `
apiVersion: xopc.ai/browser-recipe/v1
id: eval-test
name: eval-test
risk: read_only
domains: [example.com]
pipeline:
  - evaluate: |
      document.title
`;
    const result = parseBrowserPipeline(yaml);
    expect(result.ok).toBe(false);
  });
});

describe('Pipeline template expressions', () => {
  it('resolves args templates', () => {
    const result = resolveTemplate('${{ args.url }}', { args: { url: 'https://example.com' }, last: undefined, outputs: [], vars: {} });
    expect(result).toBe('https://example.com');
  });

  it('resolves last template', () => {
    const result = resolveTemplate('${{ last }}', { args: {}, last: 'hello', outputs: [], vars: {} });
    expect(result).toBe('hello');
  });

  it('resolves last with json filter', () => {
    const result = resolveTemplate('${{ last | json }}', { args: {}, last: { a: 1 }, outputs: [], vars: {} });
    expect(result).toContain('"a": 1');
  });

  it('resolves error template', () => {
    const result = resolveTemplate('${{ error.message }}', { args: {}, last: undefined, outputs: [], vars: {}, error: { code: 'ERR', message: 'Something failed' } });
    expect(result).toBe('Something failed');
  });

  it('resolves nested args', () => {
    const result = resolveTemplate('${{ args.config.timeout }}', { args: { config: { timeout: 5000 } }, last: undefined, outputs: [], vars: {} });
    expect(result).toBe('5000');
  });

  it('keeps unresolved expressions', () => {
    const result = resolveTemplate('${{ unknown.thing }}', { args: {}, last: undefined, outputs: [], vars: {} });
    expect(result).toContain('${{ unknown.thing }}');
  });

  it('deep resolves objects', () => {
    const input = { url: '${{ args.url }}', options: { timeout: '${{ args.timeout }}' } };
    const result = resolveTemplateDeep(input, { args: { url: 'https://x.com', timeout: '3000' }, last: undefined, outputs: [], vars: {} });
    expect(result).toEqual({ url: 'https://x.com', options: { timeout: '3000' } });
  });

  it('preserves non-string values for whole-template expressions', () => {
    const input = { items: '${{ args.items }}' };
    const result = resolveTemplateDeep(input, { args: { items: [{ name: 'alpha' }] }, last: undefined, outputs: [], vars: {} });
    expect(result).toEqual({ items: [{ name: 'alpha' }] });
  });
});

describe('Pipeline validation', () => {
  it('validates against action registry', () => {
    const yaml = `
apiVersion: xopc.ai/browser-recipe/v1
id: validate-test
name: validate-test
risk: read_only
domains: [example.com]
pipeline:
  - navigate:
      url: https://example.com
  - unknown_action:
      foo: bar
`;
    const registry = createBrowserActionRegistry();
    const result = validateBrowserPipeline(yaml, registry);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes('unknown_action'))).toBe(true);
  });

  it('passes validation for known actions', () => {
    const yaml = `
apiVersion: xopc.ai/browser-recipe/v1
id: valid
name: valid
risk: read_only
domains: [example.com]
pipeline:
  - navigate:
      url: https://example.com
  - wait:
      selector: body
  - screenshot:
      full_page: true
`;
    const registry = createBrowserActionRegistry();
    const result = validateBrowserPipeline(yaml, registry);
    expect(result.ok).toBe(true);
  });

});

describe('Pipeline runtime', () => {
  it('runs control flow and data actions against runtime state', async () => {
    const yaml = `
apiVersion: xopc.ai/browser-recipe/v1
id: runtime
name: runtime
risk: read_only
domains: [example.com]
pipeline:
  - set_var:
      name: items
      value:
      - name: alpha
        score: 2
      - name: beta
        score: 1
  - filter:
      from: \${{ vars.items }}
      path: name
      contains: a
  - sort:
      path: score
      direction: desc
  - limit:
      count: 1
  - assert:
      path: 0.name
      equals: alpha
  - if:
      condition: \${{ last.0.name }}
      then:
        - output:
            value: \${{ last.0.name }}
      else:
        - output:
            value: missing
`;
    const registry = createBrowserActionRegistry();
    const ctx = {
      page: {},
      manager: { getExtensionProvider: () => undefined },
      config: undefined,
      taskId: 'test',
    } as unknown as BrowserActionContext;

    const result = await runBrowserPipeline(yaml, {}, ctx, registry);

    expect(result.ok).toBe(true);
    expect(result.text).toBe('alpha');
    expect((result.data as any).trace.some((step: any) => step.action === 'if')).toBe(true);
  });
});
