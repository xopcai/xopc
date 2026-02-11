# xopcbot Skills Reference

Reference implementation for xopcbot skills system, aligned with [Agent Skills](https://agentskills.io) specification.

## Overview

Skills are **pure documentation** - they tell the agent *what* a capability does and *when* to use it. Tool implementation is separate.

```
skills/
├── weather/
│   └── SKILL.md       # Documentation only
├── github/
│   └── SKILL.md       # Documentation only
└── skills-ref/
    ├── README.md      # This file
    ├── SKILL.md       # Skill template
    ├── validate.ts    # Validation CLI
    └── to-prompt.ts   # Prompt generation
```

## Agent Skills Specification

Based on [agentskills.io/specification](https://agentskills.io/specification):

```yaml
---
name: weather                    # Skill name (kebab-case, required)
description: Get weather info    # What it does (required)
license: MIT                     # Optional
compatibility: Claude Code       # Optional
allowed-tools: curl              # Optional (experimental)
metadata:                        # Optional key-value pairs
  emoji: "🌤️"
  category: utilities
---
```

## Key Principles

1. **SKILL.md = Pure Documentation**
   - No platform-specific config
   - No `invoke_as` field (agent decides)
   - Frontmatter follows spec exactly

2. **Tool Implementation is Separate**
   - Skills don't contain code
   - Agent reads skill, decides to use tool
   - Tools are registered via plugin system

3. **Metadata is Optional**
   - Only use if truly platform-agnostic
   - `xopcbot-*` fields are deprecated

## Validation

```bash
# Validate all skills
npx tsx skills-ref/validate.ts skills/

# Generate prompt XML
npx tsx skills-ref/to-prompt.ts skills/weather skills/github
```

## Migration from Old Format

**Old:**
```yaml
---
name: weather
description: Get weather
metadata:
  xopcbot:
    emoji: "🌤️"
    invoke_as: tool
---
```

**New:**
```yaml
---
name: weather
description: Get weather
license: MIT
metadata:
  emoji: "🌤️"
---
```

Changes:
- `metadata.xopcbot` → removed
- `invoke_as` → removed (agent's decision)
- `license` → now at top level
