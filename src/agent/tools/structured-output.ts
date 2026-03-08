/**
 * Structured Output - XML Element Builder for tool outputs
 *
 * Provides structured XML output format for better parsing by LLMs.
 * Inspired by Forge's Element builder pattern.
 *
 * @example
 * ```typescript
 * const output = Element.create('file_content')
 *   .attr('path', '/src/main.ts')
 *   .attr('lines', '1-50')
 *   .cdata(fileContent)
 *   .render();
 * ```
 */

export interface ElementAttributes {
  [key: string]: string | number | boolean | undefined;
}

export class Element {
  private tag: string;
  private attributes: Map<string, string> = new Map();
  private children: Element[] = [];
  private textContent?: string;
  private isCData = false;

  constructor(tag: string) {
    this.tag = tag;
  }

  /**
   * Create a new element
   */
  static create(tag: string): Element {
    return new Element(tag);
  }

  /**
   * Create a file content element
   */
  static fileContent(path: string, content: string, options?: {
    startLine?: number;
    endLine?: number;
    totalLines?: number;
    language?: string;
  }): Element {
    const el = Element.create('file_content').attr('path', path);

    if (options?.startLine !== undefined) {
      el.attr('start_line', options.startLine);
    }
    if (options?.endLine !== undefined) {
      el.attr('end_line', options.endLine);
    }
    if (options?.totalLines !== undefined) {
      el.attr('total_lines', options.totalLines);
    }
    if (options?.language) {
      el.attr('language', options.language);
    }

    return el.cdata(content);
  }

  /**
   * Create a directory listing element
   */
  static directoryListing(path: string, entries: Array<{
    name: string;
    type: 'file' | 'directory';
    size?: number;
    modified?: Date;
  }>): Element {
    const el = Element.create('directory_listing').attr('path', path);

    for (const entry of entries) {
      const entryEl = Element.create('entry')
        .attr('name', entry.name)
        .attr('type', entry.type);

      if (entry.size !== undefined) {
        entryEl.attr('size', entry.size);
      }
      if (entry.modified) {
        entryEl.attr('modified', entry.modified.toISOString());
      }

      el.child(entryEl);
    }

    return el;
  }

  /**
   * Create a search results element
   */
  static searchResults(pattern: string, results: Array<{
    path: string;
    line: number;
    column?: number;
    match: string;
    context?: string;
  }>, options?: {
    totalResults?: number;
    truncated?: boolean;
  }): Element {
    const el = Element.create('search_results')
      .attr('pattern', pattern);

    if (options?.totalResults !== undefined) {
      el.attr('total_results', options.totalResults);
    }
    if (options?.truncated) {
      el.attr('truncated', 'true');
    }

    for (const result of results) {
      const resultEl = Element.create('result')
        .attr('path', result.path)
        .attr('line', result.line);

      if (result.column !== undefined) {
        resultEl.attr('column', result.column);
      }

      resultEl.child(Element.create('match').text(result.match));

      if (result.context) {
        resultEl.child(Element.create('context').cdata(result.context));
      }

      el.child(resultEl);
    }

    return el;
  }

  /**
   * Create a command output element
   */
  static commandOutput(command: string, output: string, options?: {
    exitCode?: number;
    executionTimeMs?: number;
    workingDirectory?: string;
  }): Element {
    const el = Element.create('command_output')
      .attr('command', command);

    if (options?.exitCode !== undefined) {
      el.attr('exit_code', options.exitCode);
    }
    if (options?.executionTimeMs !== undefined) {
      el.attr('execution_time_ms', options.executionTimeMs);
    }
    if (options?.workingDirectory) {
      el.attr('working_directory', options.workingDirectory);
    }

    return el.cdata(output);
  }

  /**
   * Create an error element
   */
  static error(message: string, options?: {
    type?: string;
    code?: string;
    suggestion?: string;
    recoverable?: boolean;
  }): Element {
    const el = Element.create('error').attr('message', message);

    if (options?.type) {
      el.attr('type', options.type);
    }
    if (options?.code) {
      el.attr('code', options.code);
    }
    if (options?.recoverable !== undefined) {
      el.attr('recoverable', options.recoverable);
    }
    if (options?.suggestion) {
      el.child(Element.create('suggestion').text(options.suggestion));
    }

    return el;
  }

  /**
   * Create a success element
   */
  static success(message: string, details?: Record<string, string>): Element {
    const el = Element.create('success').attr('message', message);

    if (details) {
      for (const [key, value] of Object.entries(details)) {
        el.child(Element.create(key).text(value));
      }
    }

    return el;
  }

  /**
   * Escape XML special characters for attribute values
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Add an attribute
   */
  attr(key: string, value: string | number | boolean | undefined): this {
    if (value !== undefined && value !== null) {
      this.attributes.set(key, this.escapeXml(String(value)));
    }
    return this;
  }

  /**
   * Add multiple attributes
   */
  attrs(attributes: ElementAttributes): this {
    for (const [key, value] of Object.entries(attributes)) {
      this.attr(key, value);
    }
    return this;
  }

  /**
   * Set text content (XML escaped)
   */
  text(content: string): this {
    this.textContent = this.escapeXml(content);
    this.isCData = false;
    return this;
  }

  /**
   * Set CDATA content (not XML escaped)
   */
  cdata(content: string): this {
    this.textContent = content;
    this.isCData = true;
    return this;
  }

  /**
   * Add a child element
   */
  child(child: Element): this {
    this.children.push(child);
    return this;
  }

  /**
   * Add multiple child elements
   */
  addChildren(children: Element[]): this {
    for (const child of children) {
      this.children.push(child);
    }
    return this;
  }

  /**
   * Render the element as XML string
   */
  render(indent: string = ''): string {
    const attrs = [...this.attributes.entries()]
      .map(([k, v]) => ` ${k}="${this.escapeXml(v)}"`)
      .join('');

    // Self-closing tag if no content and no children
    if (!this.textContent && this.children.length === 0) {
      return `${indent}<${this.tag}${attrs}/>`;
    }

    const childrenStr = this.children.map(c => c.render(indent + '  ')).join('\n');

    let content: string;
    if (this.isCData) {
      content = `<![CDATA[${this.textContent}]]>`;
    } else if (this.textContent) {
      content = this.textContent;
    } else {
      content = '';
    }

    if (childrenStr) {
      if (content) {
        return `${indent}<${this.tag}${attrs}>\n${indent}  ${content}\n${childrenStr}\n${indent}</${this.tag}>`;
      } else {
        return `${indent}<${this.tag}${attrs}>\n${childrenStr}\n${indent}</${this.tag}>`;
      }
    } else {
      return `${indent}<${this.tag}${attrs}>${content}</${this.tag}>`;
    }
  }

  /**
   * Render as compact XML (no indentation)
   */
  renderCompact(): string {
    const attrs = [...this.attributes.entries()]
      .map(([k, v]) => ` ${k}="${this.escapeXml(v)}"`)
      .join('');

    if (!this.textContent && this.children.length === 0) {
      return `<${this.tag}${attrs}/>`;
    }

    const childrenStr = this.children.map(c => c.renderCompact()).join('');

    let content: string;
    if (this.isCData) {
      content = `<![CDATA[${this.textContent}]]>`;
    } else if (this.textContent) {
      content = this.textContent;
    } else {
      content = '';
    }

    return `<${this.tag}${attrs}>${content}${childrenStr}</${this.tag}>`;
  }

  /**
   * Get the tag name
   */
  getTag(): string {
    return this.tag;
  }

  /**
   * Get an attribute value
   */
  getAttr(key: string): string | undefined {
    return this.attributes.get(key);
  }

  /**
   * Get all attributes
   */
  getAttrs(): Record<string, string> {
    return Object.fromEntries(this.attributes);
  }

  /**
   * Get text content
   */
  getText(): string | undefined {
    return this.textContent;
  }

  /**
   * Get children
   */
  getChildren(): Element[] {
    return [...this.children];
  }

  /**
   * Check if element has children
   */
  hasChildren(): boolean {
    return this.children.length > 0;
  }

  /**
   * Check if element has text content
   */
  hasText(): boolean {
    return this.textContent !== undefined && this.textContent.length > 0;
  }

  /**
   * Clone the element
   */
  clone(): Element {
    const cloned = new Element(this.tag);
    cloned.attributes = new Map(this.attributes);
    cloned.textContent = this.textContent;
    cloned.isCData = this.isCData;
    cloned.children = this.children.map(c => c.clone());
    return cloned;
  }

  /**
   * Convert to JSON representation
   */
  toJSON(): object {
    return {
      tag: this.tag,
      attributes: Object.fromEntries(this.attributes),
      text: this.textContent,
      cdata: this.isCData,
      children: this.children.map(c => c.toJSON()),
    };
  }

  /**
   * Create from JSON
   */
  static fromJSON(json: any): Element {
    const el = new Element(json.tag);

    if (json.attributes) {
      for (const [key, value] of Object.entries(json.attributes)) {
        el.attr(key, value as string);
      }
    }

    if (json.text) {
      if (json.cdata) {
        el.cdata(json.text);
      } else {
        el.text(json.text);
      }
    }

    if (json.children) {
      for (const childJson of json.children) {
        el.child(Element.fromJSON(childJson));
      }
    }

    return el;
  }
}

// XML Parser for parsing structured output
export class XMLParser {
  /**
   * Parse XML string to Element
   * Note: This is a simple parser for the output format, not a full XML parser
   */
  static parse(xml: string): Element | null {
    // Simple regex-based parser for our specific format
    const tagMatch = xml.match(/<([\w_]+)([^>]*)>([\s\S]*?)<\/\1>/);
    if (!tagMatch) {
      // Try self-closing
      const selfClosingMatch = xml.match(/<([\w_]+)([^>]*)\/>/);
      if (selfClosingMatch) {
        const [, tag, attrsStr] = selfClosingMatch;
        const el = Element.create(tag);
        XMLParser.parseAttributes(el, attrsStr);
        return el;
      }
      return null;
    }

    const [, tag, attrsStr, content] = tagMatch;
    const el = Element.create(tag);
    XMLParser.parseAttributes(el, attrsStr);

    // Check for CDATA
    const cdataMatch = content.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    if (cdataMatch) {
      el.cdata(cdataMatch[1]);
    } else {
      // Check for child elements
      const childRegex = /<([\w_]+)([^>]*)>([\s\S]*?)<\/\1>/g;
      let childMatch;
      let hasChildren = false;

      while ((childMatch = childRegex.exec(content)) !== null) {
        const child = XMLParser.parse(childMatch[0]);
        if (child) {
          el.child(child);
          hasChildren = true;
        }
      }

      if (!hasChildren) {
        // It's text content
        const trimmed = content.trim();
        if (trimmed) {
          el.text(trimmed);
        }
      }
    }

    return el;
  }

  private static parseAttributes(el: Element, attrsStr: string): void {
    const attrRegex = /(\w+)="([^"]*)"/g;
    let match;
    while ((match = attrRegex.exec(attrsStr)) !== null) {
      el.attr(match[1], match[2]);
    }
  }
}

// Utility functions for common patterns
export const StructuredOutput = {
  Element,
  XMLParser,

  // Convenience methods
  fileContent: Element.fileContent,
  directoryListing: Element.directoryListing,
  searchResults: Element.searchResults,
  commandOutput: Element.commandOutput,
  error: Element.error,
  success: Element.success,

  // Render multiple elements
  renderList(elements: Element[], separator: string = '\n\n'): string {
    return elements.map(e => e.render()).join(separator);
  },

  // Wrap in root element
  wrapInRoot(rootTag: string, children: Element[]): Element {
    const root = Element.create(rootTag);
    for (const child of children) {
      root.child(child);
    }
    return root;
  },
};

export default StructuredOutput;
