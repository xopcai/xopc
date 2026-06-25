import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadBrowserPipelineSource } from '../pipeline/source.js';
import { parseBrowserPipeline } from '../pipeline/schema.js';
import { resolveTemplate, resolveTemplateDeep } from '../pipeline/template.js';
import { runBrowserPipeline, validateBrowserPipeline, validateBrowserPipelineSource } from '../pipeline/runner.js';
import { createBrowserActionRegistry } from '../actions/registry.js';
import type { BrowserActionContext } from '../actions/types.js';

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

describe('Pipeline source loading', () => {
  it('loads pipeline YAML from a remote URL', async () => {
    const yaml = 'name: remote\npipeline:\n  - wait:\n      ms: 100';
    const fetchMock = vi.fn().mockResolvedValue(new Response(yaml, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await loadBrowserPipelineSource('https://example.com/pipeline.yaml');

      expect(result.origin).toBe('url');
      expect(result.location).toBe('https://example.com/pipeline.yaml');
      expect(result.source).toBe(yaml);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/pipeline.yaml',
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
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

  it('expands include files before validation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xopc-pipeline-'));
    const includePath = join(dir, 'common.yaml');
    const mainPath = join(dir, 'main.yaml');
    await writeFile(includePath, `
name: common
pipeline:
  - wait:
      ms: 1
`);
    await writeFile(mainPath, `
name: main
include:
  - common.yaml
pipeline:
  - output:
      value: done
`);

    const loaded = await loadBrowserPipelineSource(mainPath);
    const registry = createBrowserActionRegistry();
    const result = await validateBrowserPipelineSource(loaded.source, registry, loaded.location);

    expect(result.ok).toBe(true);
    expect(result.document!.pipeline).toHaveLength(2);
  });
});

describe('Pipeline runtime', () => {
  it('runs control flow and data actions against runtime state', async () => {
    const yaml = `
name: runtime
args:
  items:
    default:
      - name: alpha
        score: 2
      - name: beta
        score: 1
pipeline:
  - set_var:
      name: items
      value: \${{ args.items }}
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
