import { describe, it, expect } from 'vitest';
import {
  Element,
  XMLParser,
  StructuredOutput,
} from '../tools/structured-output.js';

describe('Structured Output (Element)', () => {
  describe('Element.create', () => {
    it('should create a new element', () => {
      const el = Element.create('test');
      expect(el.getTag()).toBe('test');
    });
  });

  describe('Element.attr', () => {
    it('should add attribute', () => {
      const el = Element.create('test').attr('key', 'value');
      expect(el.getAttr('key')).toBe('value');
    });

    it('should escape XML special characters in attributes', () => {
      const el = Element.create('test').attr('key', 'value <>&"\'');
      expect(el.getAttr('key')).toBe('value &lt;&gt;&amp;&quot;&apos;');
    });

    it('should ignore undefined values', () => {
      const el = Element.create('test').attr('key', undefined);
      expect(el.getAttr('key')).toBeUndefined();
    });
  });

  describe('Element.text', () => {
    it('should set text content with escaping', () => {
      const el = Element.create('test').text('Hello <world>');
      expect(el.getText()).toBe('Hello &lt;world&gt;');
    });
  });

  describe('Element.cdata', () => {
    it('should set CDATA content without escaping', () => {
      const el = Element.create('test').cdata('Hello <world>');
      expect(el.getText()).toBe('Hello <world>');
    });
  });

  describe('Element.child', () => {
    it('should add child element', () => {
      const parent = Element.create('parent');
      const child = Element.create('child');
      parent.child(child);
      
      expect(parent.getChildren().length).toBe(1);
      expect(parent.getChildren()[0].getTag()).toBe('child');
    });
  });

  describe('Element.addChildren', () => {
    it('should add multiple children', () => {
      const parent = Element.create('parent');
      const children = [
        Element.create('child1'),
        Element.create('child2'),
      ];
      parent.addChildren(children);
      
      expect(parent.getChildren().length).toBe(2);
    });
  });

  describe('Element.render', () => {
    it('should render self-closing tag', () => {
      const el = Element.create('empty');
      expect(el.render()).toBe('<empty/>');
    });

    it('should render element with text', () => {
      const el = Element.create('test').text('Hello');
      expect(el.render()).toBe('<test>Hello</test>');
    });

    it('should render element with CDATA', () => {
      const el = Element.create('test').cdata('<script>');
      expect(el.render()).toBe('<test><![CDATA[<script>]]></test>');
    });

    it('should render element with attributes', () => {
      const el = Element.create('test').attr('id', '123');
      expect(el.render()).toBe('<test id="123"/>');
    });

    it('should render element with children', () => {
      const parent = Element.create('parent')
        .child(Element.create('child').text('text'));
      const rendered = parent.render();
      expect(rendered).toContain('<parent>');
      expect(rendered).toContain('<child>text</child>');
      expect(rendered).toContain('</parent>');
    });

    it('should render with indentation', () => {
      const parent = Element.create('parent')
        .child(Element.create('child'));
      const rendered = parent.render();
      expect(rendered).toContain('\n');
    });
  });

  describe('Element.renderCompact', () => {
    it('should render without indentation', () => {
      const parent = Element.create('parent')
        .child(Element.create('child').text('text'));
      const rendered = parent.renderCompact();
      expect(rendered).not.toContain('\n');
      expect(rendered).toBe('<parent><child>text</child></parent>');
    });
  });

  describe('Factory methods', () => {
    it('should create fileContent element', () => {
      const el = Element.fileContent('/path/to/file.ts', 'content', {
        startLine: 1,
        endLine: 10,
        language: 'typescript',
      });
      
      expect(el.getTag()).toBe('file_content');
      expect(el.getAttr('path')).toBe('/path/to/file.ts');
      expect(el.getAttr('start_line')).toBe('1');
      expect(el.getAttr('language')).toBe('typescript');
    });

    it('should create directoryListing element', () => {
      const el = Element.directoryListing('/path', [
        { name: 'file1.ts', type: 'file', size: 100 },
        { name: 'dir1', type: 'directory' },
      ]);
      
      expect(el.getTag()).toBe('directory_listing');
      expect(el.getAttr('path')).toBe('/path');
      expect(el.getChildren().length).toBe(2);
    });

    it('should create searchResults element', () => {
      const el = Element.searchResults('pattern', [
        { path: '/file.ts', line: 10, match: 'found' },
      ]);
      
      expect(el.getTag()).toBe('search_results');
      expect(el.getAttr('pattern')).toBe('pattern');
    });

    it('should create commandOutput element', () => {
      const el = Element.commandOutput('ls -la', 'output', {
        exitCode: 0,
        executionTimeMs: 100,
      });
      
      expect(el.getTag()).toBe('command_output');
      expect(el.getAttr('command')).toBe('ls -la');
      expect(el.getAttr('exit_code')).toBe('0');
    });

    it('should create error element', () => {
      const el = Element.error('Something went wrong', {
        type: 'validation',
        code: 'E001',
        suggestion: 'Check input',
      });
      
      expect(el.getTag()).toBe('error');
      expect(el.getAttr('message')).toBe('Something went wrong');
      expect(el.getAttr('type')).toBe('validation');
    });

    it('should create success element', () => {
      const el = Element.success('Operation completed', {
        file: '/path/to/file',
      });
      
      expect(el.getTag()).toBe('success');
      expect(el.getAttr('message')).toBe('Operation completed');
    });
  });

  describe('Element.clone', () => {
    it('should create deep copy', () => {
      const original = Element.create('parent')
        .attr('key', 'value')
        .child(Element.create('child').text('text'));
      
      const cloned = original.clone();
      
      expect(cloned.getTag()).toBe('parent');
      expect(cloned.getAttr('key')).toBe('value');
      expect(cloned.getChildren().length).toBe(1);
      
      // Modify clone should not affect original
      cloned.attr('key', 'new-value');
      expect(original.getAttr('key')).toBe('value');
    });
  });

  describe('Element.toJSON/fromJSON', () => {
    it('should serialize and deserialize', () => {
      const original = Element.create('test')
        .attr('key', 'value')
        .text('content');
      
      const json = original.toJSON();
      const restored = Element.fromJSON(json);
      
      expect(restored.getTag()).toBe('test');
      expect(restored.getAttr('key')).toBe('value');
      expect(restored.getText()).toBe('content');
    });
  });
});

describe('XMLParser', () => {
  it('should parse simple element', () => {
    const xml = '<test>content</test>';
    const el = XMLParser.parse(xml);
    
    expect(el).not.toBeNull();
    expect(el!.getTag()).toBe('test');
    expect(el!.getText()).toBe('content');
  });

  it('should parse self-closing element', () => {
    const xml = '<test/>';
    const el = XMLParser.parse(xml);
    
    expect(el).not.toBeNull();
    expect(el!.getTag()).toBe('test');
  });

  it('should parse element with attributes', () => {
    const xml = '<test key="value" num="123"/>';
    const el = XMLParser.parse(xml);
    
    expect(el!.getAttr('key')).toBe('value');
    expect(el!.getAttr('num')).toBe('123');
  });

  it('should parse CDATA content', () => {
    const xml = '<test><![CDATA[<script>alert(1)</script>]]></test>';
    const el = XMLParser.parse(xml);
    
    expect(el!.getText()).toBe('<script>alert(1)</script>');
  });

  it('should return null for invalid XML', () => {
    const xml = 'not valid xml';
    const el = XMLParser.parse(xml);
    
    expect(el).toBeNull();
  });
});

describe('StructuredOutput utility', () => {
  it('should export Element class', () => {
    expect(StructuredOutput.Element).toBe(Element);
  });

  it('should export XMLParser class', () => {
    expect(StructuredOutput.XMLParser).toBe(XMLParser);
  });

  it('should wrap elements in root', () => {
    const children = [
      Element.create('child1'),
      Element.create('child2'),
    ];
    const root = StructuredOutput.wrapInRoot('root', children);
    
    expect(root.getTag()).toBe('root');
    expect(root.getChildren().length).toBe(2);
  });
});
