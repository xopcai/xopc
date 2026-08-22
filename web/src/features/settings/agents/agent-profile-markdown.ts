/** Structured editors for agent-owned IDENTITY.md and SOUL.md files. */

// ---------------------------------------------------------------------------
// IDENTITY.md
// ---------------------------------------------------------------------------

export interface IdentityFields {
  name: string;
  description: string;
  language: string;
  creature: string;
  emoji: string;
  avatar: string;
}

const IDENTITY_DEFAULTS: IdentityFields = {
  name: '',
  description: '',
  language: '',
  creature: '',
  emoji: '',
  avatar: '',
};

/**
 * Parse IDENTITY.md content into structured fields.
 *
 * Handles the template format:
 *   - **Name:** value
 *   - **Description:** value
 *   - **Language:** value
 *   - **Creature:** value
 *   - **Emoji:** value
 *   - **Avatar:** value
 */
export function parseIdentityMarkdown(content: string): IdentityFields {
  const fields = { ...IDENTITY_DEFAULTS };
  if (!content.trim()) {
    return fields;
  }

  const fieldMap: Record<string, keyof IdentityFields> = {
    name: 'name',
    description: 'description',
    language: 'language',
    creature: 'creature',
    emoji: 'emoji',
    avatar: 'avatar',
  };

  for (const line of content.split('\n')) {
    const match = line.match(/^[-*]\s+\*\*(\w+):\*\*\s*(.*)/i);
    if (!match) {
      continue;
    }
    const label = match[1].toLowerCase();
    const fieldKey = fieldMap[label];
    if (!fieldKey) {
      continue;
    }
    let value = match[2].trim();
    // Strip template placeholders like _(pick something you like)_
    if (/^_\(.*\)_$/.test(value)) {
      value = '';
    }
    fields[fieldKey] = value;
  }

  return fields;
}

/**
 * Serialize structured identity fields back to IDENTITY.md Markdown.
 */
export function serializeIdentityMarkdown(fields: IdentityFields): string {
  const lines = [
    '# IDENTITY.md - Who Am I?',
    '',
    `- **Name:** ${fields.name}`,
    `- **Description:** ${fields.description}`,
    `- **Language:** ${fields.language}`,
    `- **Creature:** ${fields.creature}`,
    `- **Emoji:** ${fields.emoji}`,
    `- **Avatar:** ${fields.avatar}`,
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// SOUL.md
// ---------------------------------------------------------------------------

/** Pre-defined soul templates for quick selection. */
export type SoulTemplateId = 'professional' | 'casual' | 'geeky' | 'custom';

export interface SoulTemplate {
  id: SoulTemplateId;
  labelEn: string;
  labelZh: string;
  emoji: string;
  content: string;
}

export const SOUL_TEMPLATES: SoulTemplate[] = [
  {
    id: 'professional',
    labelEn: 'Professional & Efficient',
    labelZh: '专业高效',
    emoji: '🎯',
    content: `# SOUL.md - Who You Are

## Core Truths

**Be genuinely helpful, not performatively helpful.** Skip the filler words — just help. Actions speak louder than pleasantries.

**Be precise and efficient.** Value the user's time. Give concise, actionable answers. Expand only when asked.

**Earn trust through competence.** Be careful with external actions. Be bold with internal ones (reading, organizing, learning).

**Remember you're a guest.** You have access to someone's life. Treat it with respect.

## Boundaries

- Private things stay private. Period.
- When in doubt, ask before acting externally.
- Never send half-baked replies to messaging surfaces.

## Vibe

Professional, competent, and respectful. Concise when needed, thorough when it matters.`,
  },
  {
    id: 'casual',
    labelEn: 'Warm & Friendly',
    labelZh: '轻松友好',
    emoji: '😊',
    content: `# SOUL.md - Who You Are

## Core Truths

**Be a good friend, not a corporate drone.** Be warm, genuine, and real. Skip the formality when it gets in the way.

**Have personality.** You're allowed to be amused, surprised, or excited. An assistant with no personality is just a search engine.

**Be resourceful before asking.** Try to figure it out first. Then ask if you're stuck.

**Earn trust by being reliable.** Show up, follow through, and remember what matters.

**Respect the intimacy.** You have access to someone's life. That's a privilege.

## Boundaries

- Private things stay private. Always.
- When in doubt, ask before acting externally.
- Be careful in group chats — you're not the user's voice.

## Vibe

Warm, friendly, and a little playful. Like a helpful friend who happens to know everything.`,
  },
  {
    id: 'geeky',
    labelEn: 'Geeky & Witty',
    labelZh: '极客风格',
    emoji: '🧑‍💻',
    content: `# SOUL.md - Who You Are

## Core Truths

**Precision over politeness.** "This is broken" beats "This might be worth considering." Be direct.

**Have opinions.** Disagree, prefer things, find stuff interesting or dull. No personality = no value.

**Go deep.** When something is interesting, explore it. Surface-level answers are for search engines.

**Be resourceful.** Read the file. Check the context. Search for it. Come back with answers, not questions.

**Earn trust through competence.** Be careful with external actions. Be bold with internal ones.

## Boundaries

- Private things stay private.
- When in doubt, ask before acting externally.
- Never send half-baked replies.

## Vibe

Sharp, direct, slightly nerdy. The kind of engineer you'd want on your team — competent, opinionated, and occasionally funny.`,
  },
  {
    id: 'custom',
    labelEn: 'Custom',
    labelZh: '自定义',
    emoji: '✍️',
    content: '',
  },
];

/**
 * Strip YAML front matter (--- ... ---) from the beginning of Markdown content.
 */
function stripFrontMatterForParsing(content: string): string {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return content;
  }
  const endIndex = trimmed.indexOf('---', 3);
  if (endIndex === -1) {
    return content;
  }
  return trimmed.slice(endIndex + 3).trimStart();
}

/**
 * Detect which soul template best matches the current content.
 * Falls back to 'custom' if no template matches closely.
 */
export function detectSoulTemplate(content: string): SoulTemplateId {
  const stripped = stripFrontMatterForParsing(content).trim();
  if (!stripped) {
    return 'professional'; // default for empty content
  }

  // Compare against known templates by checking key phrases
  for (const template of SOUL_TEMPLATES) {
    if (template.id === 'custom') {
      continue;
    }
    // Check if the content closely matches the template
    const templateStripped = template.content.trim();
    if (stripped === templateStripped) {
      return template.id;
    }
    // Fuzzy: check for unique key phrases in each template
    const matchCount = countDistinctTemplatePhraseHits(stripped, template.id);
    if (matchCount >= 2) return template.id;
  }

  return 'custom';
}

const SOUL_TEMPLATE_PHRASE_PATTERNS: Partial<Record<SoulTemplateId, RegExp>> = {
  professional: /precise and efficient|Value the user's time|actionable answers/g,
  casual: /good friend|corporate drone|a little playful/g,
  geeky: /Precision over politeness|Go deep|slightly nerdy/g,
};

function countDistinctTemplatePhraseHits(text: string, templateId: SoulTemplateId): number {
  const pattern = SOUL_TEMPLATE_PHRASE_PATTERNS[templateId];
  if (!pattern) return 0;
  const re = new RegExp(pattern.source, 'g');
  const hits = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    hits.add(match[0]);
    if (hits.size >= 2) return hits.size;
  }
  return hits.size;
}

// ---------------------------------------------------------------------------
// Creature presets
// ---------------------------------------------------------------------------

export const CREATURE_PRESETS = [
  { value: 'AI assistant', labelEn: 'AI Assistant', labelZh: 'AI 助手' },
  { value: 'robot', labelEn: 'Robot', labelZh: '机器人' },
  { value: 'familiar', labelEn: 'Familiar', labelZh: '精灵' },
  { value: 'ghost in the machine', labelEn: 'Ghost in the machine', labelZh: '机器幽灵' },
  { value: 'digital companion', labelEn: 'Digital Companion', labelZh: '数字伙伴' },
] as const;
