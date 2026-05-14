import { describe, it, expect } from 'vitest';

import { parseBrowserPipeline } from '../pipeline/schema.js';
import { resolveTemplate, resolveTemplateDeep } from '../pipeline/template.js';
import { validateBrowserPipeline } from '../pipeline/runner.js';
import { createBrowserActionRegistry } from '../actions/registry.js';

describe('Pipeline YAML parsing', () => {
  it('parses a valid pipeline document', () => {
    const yaml = `
name: test-pipeline
description: A test pipeline
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
name: bad
pipeline: not-an-array
`;
    const result = parseBrowserPipeline(yaml);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === 'pipeline')).toBe(true);
  });

  it('rejects steps with multiple actions', () => {
    const yaml = `
name: multi-action
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

  it('handles evaluate shorthand (string value)', () => {
    const yaml = `
name: eval-test
pipeline:
  - evaluate: |
      document.title
`;
    const result = parseBrowserPipeline(yaml);
    expect(result.ok).toBe(true);
    expect(result.document!.pipeline[0].action).toBe('evaluate');
    expect(typeof result.document!.pipeline[0].args).toBe('string');
  });
});

describe('Pipeline template expressions', () => {
  it('resolves args templates', () => {
    const result = resolveTemplate('${{ args.url }}', { args: { url: 'https://example.com' }, data: undefined });
    expect(result).toBe('https://example.com');
  });

  it('resolves data template', () => {
    const result = resolveTemplate('${{ data }}', { args: {}, data: 'hello' });
    expect(result).toBe('hello');
  });

  it('resolves data with json filter', () => {
    const result = resolveTemplate('${{ data | json }}', { args: {}, data: { a: 1 } });
    expect(result).toContain('"a": 1');
  });

  it('resolves error template', () => {
    const result = resolveTemplate('${{ error.message }}', { args: {}, data: undefined, error: { code: 'ERR', message: 'Something failed' } });
    expect(result).toBe('Something failed');
  });

  it('resolves nested args', () => {
    const result = resolveTemplate('${{ args.config.timeout }}', { args: { config: { timeout: 5000 } }, data: undefined });
    expect(result).toBe('5000');
  });

  it('keeps unresolved expressions', () => {
    const result = resolveTemplate('${{ unknown.thing }}', { args: {}, data: undefined });
    expect(result).toContain('${{ unknown.thing }}');
  });

  it('deep resolves objects', () => {
    const input = { url: '${{ args.url }}', options: { timeout: '${{ args.timeout }}' } };
    const result = resolveTemplateDeep(input, { args: { url: 'https://x.com', timeout: '3000' }, data: undefined });
    expect(result).toEqual({ url: 'https://x.com', options: { timeout: '3000' } });
  });
});

describe('Pipeline validation', () => {
  it('validates against action registry', () => {
    const yaml = `
name: validate-test
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
name: valid
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
