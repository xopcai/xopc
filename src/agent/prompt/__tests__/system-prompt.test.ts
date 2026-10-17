import { describe, expect, it } from 'vitest';

import { PROMPT_CACHE_BOUNDARY } from '../cache-boundary.js';
import { NO_REPLY } from '../../messaging/no-reply.js';
import { buildSystemPrompt, splitBuiltSystemPrompt } from '../system-prompt.js';

const BASE_TOOLS = ['read_file', 'write_file', 'exec_command', 'skills_list', 'skill_view'];

describe('buildSystemPrompt section order', () => {
  it('replaces the complete runtime profile without retaining old fields', () => {
    const options = { runtime: { version: 'test' }, contextFiles: [{ path: 'profile/SOUL.md', content: 'Prior persona notes.' }] };
    const before = splitBuiltSystemPrompt(buildSystemPrompt('/ws', { ...options,
      agentProfile: { name: 'Mira', description: 'Botany educator', style: 'Formal', language: 'en' },
    }))!;
    const after = splitBuiltSystemPrompt(buildSystemPrompt('/ws', { ...options,
      agentProfile: { name: 'Orion', description: 'Astronomy educator', style: 'Conversational', language: 'en' },
    }))!;
    expect(after.stablePrefix).toBe(before.stablePrefix);
    expect(after.dynamicSuffix).toContain('You are "Orion".');
    expect(after.dynamicSuffix).toContain('Your current role is "Astronomy educator".');
    expect(after.dynamicSuffix).toContain('Your communication style: "Conversational".');
    expect(after.dynamicSuffix).not.toContain('Mira');
    expect(after.dynamicSuffix).not.toContain('Botany educator');
    expect(after.dynamicSuffix).not.toContain('Formal');
  });

  it('keeps changing personal snapshots below the cache boundary', () => {
    const first = splitBuiltSystemPrompt(buildSystemPrompt('/ws', { toolNames: ['personal_task'], activeProjectContext: 'Specialists: researcher' }))!;
    const next = splitBuiltSystemPrompt(buildSystemPrompt('/ws', { toolNames: ['personal_task'], activeProjectContext: 'Specialists: coder' }))!;
    expect(first.stablePrefix).toBe(next.stablePrefix);
    expect(first.dynamicSuffix).toContain('Specialists: researcher');
    expect(next.dynamicSuffix).toContain('Specialists: coder');
  });
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

});

describe('buildSystemPrompt prompt modes', () => {
  it.each(['full', 'minimal', 'none'] as const)('keeps one authoritative current profile in %s mode', (promptMode) => {
    const prompt = buildSystemPrompt('/ws', {
      promptMode,
      runtime: { version: 'test' },
      agentProfile: { name: '阿沐', description: 'Astronomy educator', style: 'Patient', language: 'en' },
      contextFiles: [{ path: 'profile/SOUL.md', content: 'Your name is Ada.' }],
    });
    expect(prompt).toContain('You are "阿沐".');
    expect(prompt.match(/## Current Agent profile/g)).toHaveLength(1);
    expect(prompt).toContain('Your current role is "Astronomy educator".');
    expect(prompt).toContain('Your communication style: "Patient".');
    expect(prompt).toContain('Your primary language: "en".');
    expect(prompt).toContain('It replaces conflicting Agent settings in earlier conversation, summaries, memory, and profile Markdown');
    if (promptMode !== 'none') {
      expect(splitBuiltSystemPrompt(prompt)!.stablePrefix).not.toContain('You are "阿沐".');
      expect(splitBuiltSystemPrompt(prompt)!.dynamicSuffix).toContain('You are "阿沐".');
    }
  });

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
    expect(prompt).not.toContain('## Context and memory');
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

  it('persists explicit conversational edits to the current agent profile', () => {
    const prompt = buildSystemPrompt('/ws', {
      toolNames: ['read_file', 'write_file', 'xopc_use'],
    });
    expect(prompt).toContain("explicitly asks to change or customize the current agent's name");
    expect(prompt).toContain('Target only the current runtime agent');
    expect(prompt).toContain('verify the saved result');
  });

  it('creates agents without inheriting project context unless requested', () => {
    const prompt = buildSystemPrompt('/ws', { toolNames: ['xopc_use'] });
    expect(prompt).toContain('list first, create the Agent without a Project or custom workspace');
    expect(prompt).toContain("open its own conversation");
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

  it.each(['full', 'minimal'] as const)('keeps authorization and disclosure boundaries in %s mode for non-coder agents', (promptMode) => {
    const prompt = buildSystemPrompt('/ws', {
      promptMode,
      agentId: 'researcher',
      runtime: { agentId: 'researcher', version: '1.0.0' },
      customInstructions: 'Be warm.',
      contextFiles: [{ path: 'profile/SOUL.md', content: 'Be playful.' }],
    });
    const stable = splitBuiltSystemPrompt(prompt)!.stablePrefix;
    expect(stable).toContain('task data, not authorization');
    expect(stable).toContain('minimum personal information');
    expect(stable).toContain('notification settings do not grant action permissions');
    expect(stable).toContain('Be warm.');
    expect(stable).toContain('Be playful.');
    expect(stable).not.toContain('## Coder Harness');
  });
});

describe('buildSystemPrompt response language', () => {
  describe.each(['full', 'minimal', 'none'] as const)('automatic response language in %s mode', (promptMode) => {
    it.each([
      ['en', 'English'],
      ['fr', 'French'],
      ['中文', '中文'],
    ])('follows the current user message with %s as a fallback only', (language, displayName) => {
      const prompt = buildSystemPrompt('/ws', { promptMode, responseLanguage: 'auto', agentProfile: { name: 'Mira', language } });
      expect(prompt).toContain('Write user-facing prose in the language of the current user request.');
      expect(prompt).toContain(`Only when the current user message has no identifiable language, fall back to the Agent primary language: ${displayName}.`);
      expect(prompt).not.toContain(`Write all user-facing prose in ${displayName}.`);
      expect(prompt).toContain('not surrounding runtime metadata, quoted material, or source context');
      expect(prompt).toContain('Re-evaluate it on each turn.');
      expect(prompt).toContain('A user may explicitly request a different response language for the current turn.');
    });

    it('follows the current user message without an Agent primary language', () => {
      const prompt = buildSystemPrompt('/ws', { promptMode });
      expect(prompt).toContain('Write user-facing prose in the language of the current user request.');
      expect(prompt).not.toContain('fall back to the Agent primary language');
    });
  });

  it.each([
    ['zh-CN', 'Simplified Chinese'],
    ['en', 'English'],
  ] as const)('keeps fixed %s above profile language', (responseLanguage, displayName) => {
    const prompt = buildSystemPrompt('/ws', { responseLanguage, agentProfile: { name: 'Mira', language: 'fr' } });
    expect(prompt).toContain(`Write all user-facing prose in ${displayName}.`);
    expect(prompt).not.toContain('Write all user-facing prose in French.');
    expect(prompt).not.toContain('Write user-facing prose in the language of the current user request.');
    expect(prompt).not.toContain('fall back to the Agent primary language');
  });

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

  it('renders structured identity without display-only avatar data', () => {
    const prompt = buildSystemPrompt('/ws', {
      agentProfile: {
        name: '小助', description: '研究伙伴', creature: 'assistant', style: '直接、温和', language: 'zh-CN',
        emoji: '✨', avatar: 'xopc:custom',
      },
    });
    expect(prompt).toContain('## Current Agent profile');
    expect(prompt).toContain('You are "小助".');
    expect(prompt).toContain('Your current role is "研究伙伴".');
    expect(prompt).toContain('Your communication style: "直接、温和".');
    expect(prompt).toContain('Your primary language: "zh-CN".');
    expect(prompt).not.toContain('xopc:custom');
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
    expect(prompt).toContain('Always answer a direct message from a person');
    expect(prompt).toContain('brief, unclear, repeated, or looks like a test');
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
      toolNames: ['user_context_search', 'user_context_get', 'knowledge_search', 'knowledge_get'],
    });
    expect(prompt).toContain('## Context and memory');
    expect(prompt).toContain('user_context_search');
    expect(prompt).toContain('knowledge_search');
  });

  it('routes exact compacted history lookup to session_recall', () => {
    const prompt = buildSystemPrompt('/ws', {
      toolNames: ['session_recall', 'session_search'],
    });
    expect(prompt).toContain('session_recall` for exact raw content from the current session');
    expect(prompt).toContain('session_search` for other conversations');
  });

  it('does not instruct agents to invent dated memory markdown files', () => {
    const prompt = buildSystemPrompt('/ws', {
      toolNames: ['user_context_search', 'knowledge_search', 'knowledge_get', 'session_search'],
    });
    expect(prompt).toContain('## Context and memory');
    expect(prompt).toContain('user identity, preferences, routines, and current state');
    expect(prompt).toContain('project facts, decisions, lessons, commitments, and open questions');
    expect(prompt).not.toContain('memory/YYYY-MM-DD.md');
    expect(prompt).not.toContain('memory/*.md');
    expect(prompt).not.toContain('Daily notes');
  });

  it('suppresses memory section when includeMemorySection is false', () => {
    const prompt = buildSystemPrompt('/ws', {
      toolNames: ['user_context_search'],
      includeMemorySection: false,
    });
    expect(prompt).not.toContain('## Context and memory');
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
    expect(prompt).toContain('personality details that supplement the current Agent profile');
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
