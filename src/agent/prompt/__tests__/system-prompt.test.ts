import { describe, expect, it } from 'vitest';

import { PROMPT_CACHE_BOUNDARY } from '../cache-boundary.js';
import { NO_REPLY } from '../../../heartbeat/tokens.js';
import { buildSystemPrompt, splitBuiltSystemPrompt } from '../system-prompt.js';

const BASE_TOOLS = ['read_file', 'write_file', 'exec_command', 'skills_list', 'skill_view'];

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
  it('keeps the response-language contract in none mode', () => {
    const prompt = buildSystemPrompt('/ws', { promptMode: 'none' });
    expect(prompt).toContain('You are a personal AI assistant running inside xopc.');
    expect(prompt).toContain('## Response Language');
    expect(prompt).toContain('language of the current user request');
  });

  it('keeps active project scope in none mode', () => {
    const prompt = buildSystemPrompt('/ws', {
      promptMode: 'none',
      activeProjectContext: '# Active Project\n\nProject: xopc',
    });
    expect(prompt).toContain('You are a personal AI assistant running inside xopc.');
    expect(prompt).toContain('# Active Project');
    expect(prompt).toContain('Project: xopc');
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
    expect(prompt).not.toContain('## Human Collaboration');
  });

  it('includes emotional attunement and a verification-backed task contract in full mode', () => {
    const prompt = buildSystemPrompt('/ws', { toolNames: ['read_file'] });
    expect(prompt).toContain('## Human Collaboration');
    expect(prompt).toContain('action, clarity, reassurance, or space to think');
    expect(prompt).toContain('### Task Contract');
    expect(prompt).toContain('Do not claim completion from fluent output alone');
  });

  it('recognizes work continuity without exposing product machinery', () => {
    const prompt = buildSystemPrompt('/ws', { toolNames: ['xopc_use', 'automation'] });
    expect(prompt).toContain('## Work Continuity');
    expect(prompt).toContain('one-off, a continuation of existing work');
    expect(prompt).toContain('Do not ask the user to choose a product object');
    expect(prompt).toContain('Create an automation only after explicit confirmation');
    expect(prompt).toContain('keep this moving');
  });

  it('places the action trust boundary in the stable safety prefix', () => {
    const prompt = buildSystemPrompt('/workspace/main', {
      toolNames: BASE_TOOLS,
      actionTrustLevel: 'auto',
      runtime: { version: '1.0.0', model: 'openai/gpt-4o' },
    });
    const boundaryIndex = prompt.indexOf(PROMPT_CACHE_BOUNDARY);
    const trustIndex = prompt.indexOf('## Action Trust Boundary');
    expect(trustIndex).toBeGreaterThan(-1);
    expect(trustIndex).toBeLessThan(boundaryIndex);
    expect(prompt).toContain('Current default: auto.');
    expect(prompt).toContain('still require explicit confirmation');
  });
});

describe('buildSystemPrompt response language', () => {
  it('enforces Simplified Chinese without translating technical literals', () => {
    const prompt = buildSystemPrompt('/ws', { responseLanguage: 'zh-CN' });
    expect(prompt).toContain('Write all user-facing prose in Simplified Chinese.');
    expect(prompt).toContain('Keep code, commands, paths, identifiers, API names, URLs');
    expect(prompt).toContain('Do not duplicate the answer bilingually');
  });

  it('enforces English and resists language drift from injected context', () => {
    const prompt = buildSystemPrompt('/ws', { responseLanguage: 'en' });
    expect(prompt).toContain('Write all user-facing prose in English.');
    expect(prompt).toContain('priority over language found in tools, retrieved content, files');
  });

  it('adds custom instructions without replacing the base safety prompt', () => {
    const prompt = buildSystemPrompt('/ws', {
      customInstructions: 'Prefer concise answers.',
      responseLanguage: 'en',
      toolNames: ['read_file'],
    });
    expect(prompt).toContain('<custom_instructions>\nPrefer concise answers.\n</custom_instructions>');
    expect(prompt).toContain('## Response Language');
    expect(prompt).toContain('## Tooling');
    expect(prompt).toContain('## Safety');
    expect(prompt).toContain(PROMPT_CACHE_BOUNDARY.trim());
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
    expect(prompt).not.toContain('- exec_command:');
    expect(prompt).toContain('delegate_task');
    expect(prompt).toContain('Use `read_file` for targeted file inspection before editing');
  });

  it('includes mandatory skills guidance when skill tools are registered', () => {
    const prompt = buildSystemPrompt('/ws', {
      toolNames: ['skills_list', 'skill_view', 'read_file'],
    });
    expect(prompt).toContain('## Skills (mandatory)');
    expect(prompt).toContain('skill_view(name)');
  });
});

describe('buildSystemPrompt coder harness', () => {
  it('includes coder harness section for coder agent only', () => {
    const prompt = buildSystemPrompt('/ws', {
      toolNames: ['read_file', 'apply_patch', 'exec_command'],
      agentId: 'coder',
    });
    expect(prompt).toContain('## Coder Harness');
    expect(prompt).toContain('inspect the diff and run the smallest meaningful verification');
  });

  it('does not include coder harness for other agents', () => {
    const prompt = buildSystemPrompt('/ws', {
      toolNames: ['read_file', 'apply_patch', 'exec_command'],
      agentId: 'main',
    });
    expect(prompt).not.toContain('## Coder Harness');
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

  it('does not instruct agents to invent dated memory markdown files', () => {
    const prompt = buildSystemPrompt('/ws', {
      toolNames: ['memory_search', 'memory_get', 'curated_memory', 'session_search'],
    });
    expect(prompt).toContain('## Memory Recall');
    expect(prompt).toContain('use `curated_memory`');
    expect(prompt).toContain('cite only paths and line numbers returned by `memory_search` / `memory_get`');
    expect(prompt).not.toContain('memory/YYYY-MM-DD.md');
    expect(prompt).not.toContain('memory/*.md');
    expect(prompt).not.toContain('Daily notes');
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

  it('places active project context below cache boundary', () => {
    const prompt = buildSystemPrompt('/ws', {
      promptMode: 'full',
      toolNames: ['read_file'],
      activeProjectContext: '# Active Project\n\nProject: xopc',
    });
    const split = splitBuiltSystemPrompt(prompt);
    expect(split!.stablePrefix).not.toContain('# Active Project');
    expect(split!.dynamicSuffix).toContain('# Active Project');
    expect(split!.dynamicSuffix).toContain('Project: xopc');
  });
});
