/**
 * Bidirectional parser for agent profile Markdown (IDENTITY.md, USER.md, SOUL.md).
 *
 * Converts structured form fields ↔ Markdown so the settings UI can use friendly
 * inputs while keeping the on-disk format compatible with the agent runtime.
 */

// ---------------------------------------------------------------------------
// IDENTITY.md
// ---------------------------------------------------------------------------

export interface IdentityFields {
  name: string;
  creature: string;
  emoji: string;
  avatar: string;
}

const IDENTITY_DEFAULTS: IdentityFields = {
  name: '',
  creature: '',
  emoji: '',
  avatar: '',
};

/**
 * Parse IDENTITY.md content into structured fields.
 *
 * Handles the template format:
 *   - **Name:** value
 *   - **Creature:** value
 *   - **Vibe:** value
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
    `- **Creature:** ${fields.creature}`,
    `- **Emoji:** ${fields.emoji}`,
    `- **Avatar:** ${fields.avatar}`,
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// USER.md (human side of the profile)
// ---------------------------------------------------------------------------

export interface UserFields {
  callName: string;
  pronouns: string;
  timezone: string;
  notes: string;
}

const USER_DEFAULTS: UserFields = {
  callName: '',
  pronouns: '',
  timezone: '',
  notes: '',
};

/**
 * Parse USER.md content into structured fields.
 *
 * Handles the template format:
 *   - **Name:** value
 *   - **What to call them:** value
 *   - **Pronouns:** value
 *   - **Timezone:** value
 *   - **Notes:** value
 *
 * Also captures the Context section as free-text notes.
 */
export function parseUserMarkdown(content: string): UserFields {
  const fields = { ...USER_DEFAULTS };
  if (!content.trim()) {
    return fields;
  }

  const fieldMap: Record<string, keyof UserFields> = {
    name: 'callName',
    'what to call them': 'callName',
    pronouns: 'pronouns',
    timezone: 'timezone',
    notes: 'notes',
  };

  const lines = content.split('\n');
  let contextStartIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect the ## Context section
    if (/^##\s+Context/i.test(line)) {
      contextStartIndex = i + 1;
      continue;
    }

    const match = line.match(/^[-*]\s+\*\*(.+?):\*\*\s*(.*)/i);
    if (!match) {
      continue;
    }
    const label = match[1].toLowerCase().trim();
    const fieldKey = fieldMap[label];
    if (!fieldKey) {
      continue;
    }
    let value = match[2].trim();
    // Strip template placeholders like _(optional)_
    if (/^_\(.*\)_$/.test(value)) {
      value = '';
    }
    fields[fieldKey] = value;
  }

  // Capture context section content as extra notes
  if (contextStartIndex > 0) {
    const contextLines = lines.slice(contextStartIndex);
    const contextText = contextLines
      .join('\n')
      .replace(/^_\(.*?\)_\s*/gm, '') // strip template placeholders
      .replace(/^---\s*$/gm, '') // strip trailing horizontal rules
      .replace(/The more you know.*$/s, '') // strip template footer
      .trim();

    if (contextText && !fields.notes) {
      fields.notes = contextText;
    }
  }

  return fields;
}

/**
 * Serialize structured user fields back to USER.md Markdown.
 */
export function serializeUserMarkdown(fields: UserFields): string {
  const lines = [
    '# USER.md - About Your Human',
    '',
    `- **Name:** ${fields.callName}`,
    `- **Pronouns:** ${fields.pronouns}`,
    `- **Timezone:** ${fields.timezone}`,
    '',
  ];

  if (fields.notes.trim()) {
    lines.push('## Context', '', fields.notes.trim(), '');
  }

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
// Timezone helpers
// ---------------------------------------------------------------------------

/** Common timezone options for the dropdown. */
export const TIMEZONE_OPTIONS = [
  { value: '', labelEn: 'Not set', labelZh: '未设置' },
  { value: 'Asia/Shanghai', labelEn: 'Asia/Shanghai (CST, UTC+8)', labelZh: '亚洲/上海 (北京时间, UTC+8)' },
  { value: 'Asia/Tokyo', labelEn: 'Asia/Tokyo (JST, UTC+9)', labelZh: '亚洲/东京 (日本时间, UTC+9)' },
  { value: 'Asia/Seoul', labelEn: 'Asia/Seoul (KST, UTC+9)', labelZh: '亚洲/首尔 (韩国时间, UTC+9)' },
  { value: 'Asia/Singapore', labelEn: 'Asia/Singapore (SGT, UTC+8)', labelZh: '亚洲/新加坡 (UTC+8)' },
  { value: 'Asia/Hong_Kong', labelEn: 'Asia/Hong Kong (HKT, UTC+8)', labelZh: '亚洲/香港 (UTC+8)' },
  { value: 'Asia/Taipei', labelEn: 'Asia/Taipei (CST, UTC+8)', labelZh: '亚洲/台北 (UTC+8)' },
  { value: 'Asia/Kolkata', labelEn: 'Asia/Kolkata (IST, UTC+5:30)', labelZh: '亚洲/加尔各答 (印度时间, UTC+5:30)' },
  { value: 'Asia/Dubai', labelEn: 'Asia/Dubai (GST, UTC+4)', labelZh: '亚洲/迪拜 (UTC+4)' },
  { value: 'Europe/London', labelEn: 'Europe/London (GMT/BST)', labelZh: '欧洲/伦敦 (格林尼治时间)' },
  { value: 'Europe/Paris', labelEn: 'Europe/Paris (CET, UTC+1)', labelZh: '欧洲/巴黎 (中欧时间, UTC+1)' },
  { value: 'Europe/Berlin', labelEn: 'Europe/Berlin (CET, UTC+1)', labelZh: '欧洲/柏林 (中欧时间, UTC+1)' },
  { value: 'Europe/Moscow', labelEn: 'Europe/Moscow (MSK, UTC+3)', labelZh: '欧洲/莫斯科 (UTC+3)' },
  { value: 'America/New_York', labelEn: 'America/New York (EST, UTC-5)', labelZh: '美国/纽约 (东部时间, UTC-5)' },
  { value: 'America/Chicago', labelEn: 'America/Chicago (CST, UTC-6)', labelZh: '美国/芝加哥 (中部时间, UTC-6)' },
  { value: 'America/Denver', labelEn: 'America/Denver (MST, UTC-7)', labelZh: '美国/丹佛 (山地时间, UTC-7)' },
  { value: 'America/Los_Angeles', labelEn: 'America/Los Angeles (PST, UTC-8)', labelZh: '美国/洛杉矶 (太平洋时间, UTC-8)' },
  { value: 'America/Sao_Paulo', labelEn: 'America/São Paulo (BRT, UTC-3)', labelZh: '美洲/圣保罗 (巴西时间, UTC-3)' },
  { value: 'Australia/Sydney', labelEn: 'Australia/Sydney (AEST, UTC+10)', labelZh: '澳大利亚/悉尼 (UTC+10)' },
  { value: 'Pacific/Auckland', labelEn: 'Pacific/Auckland (NZST, UTC+12)', labelZh: '太平洋/奥克兰 (新西兰时间, UTC+12)' },
] as const;

/**
 * Try to detect the user's timezone from the browser.
 */
export function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Vibe presets
// ---------------------------------------------------------------------------

const VIBE_PRESETS = [
  { value: 'warm', labelEn: 'Warm', labelZh: '温暖' },
  { value: 'sharp', labelEn: 'Sharp', labelZh: '犀利' },
  { value: 'calm', labelEn: 'Calm', labelZh: '沉稳' },
  { value: 'playful', labelEn: 'Playful', labelZh: '活泼' },
  { value: 'professional', labelEn: 'Professional', labelZh: '专业' },
  { value: 'casual', labelEn: 'Casual', labelZh: '随意' },
  { value: 'witty', labelEn: 'Witty', labelZh: '机智' },
  { value: 'concise', labelEn: 'Concise', labelZh: '简洁' },
] as const;

// ---------------------------------------------------------------------------
// Creature presets
// ---------------------------------------------------------------------------

export const PRONOUNS_PRESETS = [
  { value: '先生', labelEn: 'Mr.', labelZh: '先生' },
  { value: '女士', labelEn: 'Ms.', labelZh: '女士' },
  { value: '同学', labelEn: 'Colleague', labelZh: '同学' },
  { value: '老师', labelEn: 'Teacher', labelZh: '老师' },
  { value: '老板', labelEn: 'Boss', labelZh: '老板' },
  { value: '朋友', labelEn: 'Friend', labelZh: '朋友' },
] as const;

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
