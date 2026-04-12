import { describe, expect, it } from "vitest";
import { parseFrontmatterBlock } from "../frontmatter.js";

describe("parseFrontmatterBlock", () => {
  it("parses YAML block scalars", () => {
    const content = `---
name: yaml-hook
description: |
  line one
  line two
---
`;
    const result = parseFrontmatterBlock(content);
    expect(result.name).toBe("yaml-hook");
    expect(result.description).toBe("line one\nline two");
  });

  it("handles multi-line metadata", () => {
    const content = `---
name: session-memory
metadata:
  xopc:
    emoji: disk
    events:
      - command:new
---
`;
    const result = parseFrontmatterBlock(content);
    expect(result.metadata).toBeDefined();

    const parsed = JSON.parse(result.metadata ?? "");
    expect(parsed.xopc?.emoji).toBe("disk");
  });

  it("preserves inline JSON values", () => {
    const content = `---
name: inline-json
metadata: {"xopc": {"events": ["test"]}}
---
`;
    const result = parseFrontmatterBlock(content);
    expect(result.metadata).toBe('{"xopc": {"events": ["test"]}}');
  });

  it("stringifies YAML objects and arrays", () => {
    const content = `---
name: yaml-objects
enabled: true
retries: 3
tags:
  - alpha
  - beta
metadata:
  xopc:
    events:
      - command:new
---
`;
    const result = parseFrontmatterBlock(content);
    expect(result.enabled).toBe("true");
    expect(result.retries).toBe("3");
    expect(JSON.parse(result.tags ?? "[]")).toEqual(["alpha", "beta"]);
    const parsed = JSON.parse(result.metadata ?? "");
    expect(parsed.xopc?.events).toEqual(["command:new"]);
  });

  it("returns empty when frontmatter is missing", () => {
    const content = "# No frontmatter";
    expect(parseFrontmatterBlock(content)).toEqual({});
  });
});
