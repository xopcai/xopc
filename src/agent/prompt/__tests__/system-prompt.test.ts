import { describe, expect, it } from 'vitest';

import { PROMPT_CACHE_BOUNDARY } from '../cache-boundary.js';
import { NO_REPLY } from '../../../heartbeat/tokens.js';
import { buildSystemPrompt, splitBuiltSystemPrompt } from '../system-prompt.js';

const BASE_TOOLS = ['read_file', 'write_file', 'shell', 'skills_list', 'skill_view'];

describe('buildSystemPrompt section order', () => {
  it('places Tooling before Safety and Project Context before cache boundary', () => {
    const prompt = buildSystemPrompt('/workspace/main', {
      toolNames: BASE_TOOLS,
      channels: ['webchat', 'telegram'],
      runtime: { version: '0.0.99', model: 'openai/gpt-4o', channel: 'webchat' },
      contextFiles: [{ path: 'profile/AGENTS.md', content: 'rules' }],
    });

    const toolingIndex = prompt.indexOf('## Tooling');
    const safetyIndex = prompt.indexOf('## Safety');
    const projectIndex = prompt.indexOf('# Project Context');
    const boundaryIndex = prompt.indexOf(PROMPT_CACHE_BOUNDARY);
    const runtimeIndex = prompt.indexOf('## Runtime');

    expect(toolingIndex).toBeGreaterThan(-1);
    expect(safetyIndex).toBeGreaterThan(toolingIndex);
    expect(projectIndex).toBeGreaterThan(safetyIndex);
    expect(boundaryIndex).toBeGreaterThan(projectIndex);
    expect(runtimeIndex).toBeGreaterThan(boundaryIndex);
  });

  it('places HEARTBEAT in Dynamic Project Context below boundary', () => {
    const prompt = buildSystemPrompt('/workspace/main', {
      heartbeatEnabled: true,
      toolNames: BASE_TOOLS,
      contextFiles: [
        { path: 'profile/AGENTS.md', content: 'rules' },
        { path: 'profile/HEARTBEAT.md', content: 'check inbox' },
      ],
    });
    const split = splitBuiltSystemPrompt(prompt);
    expect(split).toBeDefined();
    expect(split!.stablePrefix).toContain('# Project Context');
    expect(split!.stablePrefix).not.toContain('check inbox');
    expect(split!.dynamicSuffix).toContain('# Dynamic Project Context');
    expect(split!.dynamicSuffix).toContain('check inbox');
    expect(split!.dynamicSuffix).toContain('## Heartbeats');
  });
});

describe('buildSystemPrompt prompt modes', () => {
  it('returns identity-only prompt for none mode', () => {
    expect(buildSystemPrompt('/ws', { promptMode: 'none' })).toBe(
      'You are a personal AI assistant running inside xopc.',
    );
  });

  it('omits full-mode sections in minimal mode but keeps Tooling and Runtime', () => {
    const prompt = buildSystemPrompt('/ws', {
      promptMode: 'minimal',
      toolNames: BASE_TOOLS,
      runtime: { version: '1.0.0', model: 'openai/gpt-4o' },
    });
    expect(prompt).toContain('## Tooling');
    expect(prompt).toContain('## Runtime');
    expect(prompt).not.toContain('## Execution Bias');
    expect(prompt).not.toContain('## Memory Recall');
    expect(prompt).not.toContain('## Silent Replies');
    expect(prompt).not.toContain('## Messaging');
  });
});

describe('buildSystemPrompt tooling', () => {
  it('lists only registered tools', () => {
    const prompt = buildSystemPrompt('/ws', {
      toolNames: ['read_file', 'grep', 'delegate_task'],
    });
    expect(prompt).toContain('- read_file:');
    expect(prompt).toContain('- grep:');
    expect(prompt).toContain('- delegate_task:');
    expect(prompt).not.toContain('- shell:');
    expect(prompt).toContain('delegate_task');
  });

  it('includes mandatory skills guidance when skill tools are registered', () => {
    const prompt = buildSystemPrompt('/ws', {
      toolNames: ['skills_list', 'skill_view', 'read_file'],
    });
    expect(prompt).toContain('## Skills (mandatory)');
    expect(prompt).toContain('skill_view(name)');
  });
});

describe('buildSystemPrompt messaging and silent replies', () => {
  it('includes NO_REPLY rules in full mode', () => {
    const prompt = buildSystemPrompt('/ws', {
      toolNames: ['send_message', 'read_file'],
      channels: ['telegram', 'webchat'],
    });
    expect(prompt).toContain('## Messaging');
    expect(prompt).toContain('## Silent Replies');
    expect(prompt).toContain(NO_REPLY);
  });

  it('skips silent replies when mode is none', () => {
    const prompt = buildSystemPrompt('/ws', {
      toolNames: ['send_message'],
      channels: ['webchat'],
      silentReplyPromptMode: 'none',
    });
    expect(prompt).not.toContain('## Silent Replies');
  });
});

describe('buildSystemPrompt memory gating', () => {
  it('includes memory section when memory tools are available', () => {
    const prompt = buildSystemPrompt('/ws', {
      toolNames: ['memory_search', 'memory_get'],
    });
    expect(prompt).toContain('## Memory Recall');
    expect(prompt).toContain('memory_search');
  });

  it('suppresses memory section when includeMemorySection is false', () => {
    const prompt = buildSystemPrompt('/ws', {
      toolNames: ['memory_search'],
      includeMemorySection: false,
    });
    expect(prompt).not.toContain('## Memory Recall');
  });
});

describe('buildSystemPrompt project context', () => {
  it('includes stable Project Context with SOUL guidance', () => {
    const prompt = buildSystemPrompt('/workspace/main', {
      toolNames: BASE_TOOLS,
      contextFiles: [
        { path: 'profile/SOUL.md', content: 'Be kind.' },
        { path: 'profile/AGENTS.md', content: 'Follow rules.' },
      ],
    });
    expect(prompt).toContain('# Project Context');
    expect(prompt).toContain('embody its persona');
    expect(prompt).toContain('## profile/SOUL.md');
    expect(prompt).toContain('Be kind.');
  });

  it('sanitizes workspace path in prompt', () => {
    const prompt = buildSystemPrompt('/tmp/evil\ninject', { toolNames: ['read_file'] });
    expect(prompt).toContain('## Workspace');
    expect(prompt).not.toContain('evil\ninject');
  });
});

describe('buildSystemPrompt provider contribution', () => {
  it('allows section overrides', () => {
    const prompt = buildSystemPrompt('/ws', {
      toolNames: ['read_file'],
      promptContribution: {
        sectionOverrides: {
          tool_call_style: '## Tool Call Style\nCustom tool style.',
        },
      },
    });
    expect(prompt).toContain('Custom tool style.');
    expect(prompt).not.toContain('do not narrate routine');
  });
});

describe('buildSystemPrompt extra context', () => {
  it('places subagent context below cache boundary in minimal mode', () => {
    const prompt = buildSystemPrompt('/ws', {
      promptMode: 'minimal',
      toolNames: ['read_file'],
      extraSystemPrompt: '# Subagent Context\n\nDo the task.',
    });
    const split = splitBuiltSystemPrompt(prompt);
    expect(split!.dynamicSuffix).toContain('## Subagent Context');
    expect(split!.dynamicSuffix).toContain('Do the task.');
  });
});
