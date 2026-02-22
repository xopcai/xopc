---
name: find-skills
description: Helps users discover, install, and manage agent skills in xopcbot workspace
license: MIT
metadata:
  openclaw:
    requires:
      bins: [git]
    install:
      - id: git-clone
        kind: download
        label: Clone skills repository
---

# Find Skills

This skill helps you discover, install, and manage skills in the xopcbot ecosystem.

## When to Use This Skill

Use this skill when the user:

- Asks "how do I do X" where X might be a common task with an existing skill
- Says "find a skill for X" or "is there a skill for X"
- Asks "can you do X" where X is a specialized capability
- Wants to install a skill from GitHub or skills.sh
- Needs to manage installed skills (enable, disable, configure)
- Wants to browse available skills

## xopcbot Skills CLI Commands

xopcbot provides built-in commands for skill management:

### List Available Skills

```bash
# List all skills (builtin + workspace + global)
xopcbot skills list

# Show detailed information
xopcbot skills list -v

# JSON format
xopcbot skills list --json
```

### Install Skills

**From GitHub:**

```bash
# Clone a skill repository to workspace
git clone <repo-url> ~/.xopcbot/workspace/skills/<skill-name>

# Example: Install vercel-react-best-practices
git clone https://github.com/vercel-labs/agent-skills.git ~/.xopcbot/workspace/skills/vercel-react-best-practices-temp
mv ~/.xopcbot/workspace/skills/vercel-react-best-practices-temp/SKILL.md ~/.xopcbot/workspace/skills/vercel-react-best-practices/SKILL.md
rm -rf ~/.xopcbot/workspace/skills/vercel-react-best-practices-temp
```

**Using xopcbot skills install (for skills with install specs):**

```bash
# Install skill dependencies
xopcbot skills install <skill-name>

# Specify install method
xopcbot skills install <skill-name> -i <install-id>

# Dry run (preview)
xopcbot skills install <skill-name> --dry-run
```

### Enable/Disable Skills

```bash
# Enable a skill
xopcbot skills enable <skill-name>

# Disable a skill
xopcbot skills disable <skill-name>
```

### Check Skill Status

```bash
# Show all skills status
xopcbot skills status

# Show specific skill details
xopcbot skills status <skill-name>

# JSON format
xopcbot skills status --json
```

### Configure Skills

```bash
# Show current configuration
xopcbot skills config <skill-name> --show

# Set API key
xopcbot skills config <skill-name> --api-key=YOUR_API_KEY

# Set environment variables
xopcbot skills config <skill-name> --env API_KEY=value --env DEBUG=true
```

### Test Skills

```bash
# Test all skills
xopcbot skills test

# Test specific skill
xopcbot skills test <skill-name>

# Validate SKILL.md file
xopcbot skills test validate ./skills/weather/SKILL.md

# Security audit
xopcbot skills test security --deep
```

## How to Help Users Find and Install Skills

### Step 1: Understand What They Need

When a user asks for help with something, identify:

1. **The domain** (e.g., React, testing, design, deployment)
2. **The specific task** (e.g., writing tests, creating animations, reviewing PRs)
3. **Whether a skill likely exists** for this common task

### Step 2: Search for Skills

**Option A: Check installed skills first**

```bash
xopcbot skills list -v
```

**Option B: Search online skill repositories**

Use your browsing capabilities to search:
- https://skills.sh/ - Official skills marketplace
- GitHub: Search for "agent-skills" or "claude-skills"
- Popular repos:
  - `vercel-labs/agent-skills`
  - `ComposioHQ/awesome-claude-skills`
  - `openclaw/openclaw/skills`

### Step 3: Install the Skill

**For xopcbot-compatible skills:**

1. **Check if skill has install specs** in SKILL.md:
   ```bash
   xopcbot skills status <skill-name>
   ```

2. **Install dependencies** (if any):
   ```bash
   xopcbot skills install <skill-name>
   ```

**For GitHub skills (manual installation):**

1. **Create skill directory** in workspace:
   ```bash
   mkdir -p ~/.xopcbot/workspace/skills/<skill-name>
   ```

2. **Download SKILL.md**:
   ```bash
   # From GitHub
   curl -L https://raw.githubusercontent.com/<owner>/<repo>/main/skills/<skill-name>/SKILL.md \
     -o ~/.xopcbot/workspace/skills/<skill-name>/SKILL.md
   
   # Or clone and copy
   git clone <repo-url> /tmp/skill-temp
   cp /tmp/skill-temp/skills/<skill-name>/SKILL.md ~/.xopcbot/workspace/skills/<skill-name>/
   rm -rf /tmp/skill-temp
   ```

3. **Verify installation**:
   ```bash
   xopcbot skills list | grep <skill-name>
   ```

### Step 4: Present Results to User

When you find relevant skills, present them with:

1. **Skill name and description**
2. **Installation status** (already installed / needs installation)
3. **Install command** (if not installed)
4. **Link to learn more**

**Example response:**

```
I found a skill that might help!

📦 vercel-react-best-practices
   React and Next.js performance optimization guidelines from Vercel Engineering.

Status: ✅ Already installed

You can start using it immediately! Just ask me to help with React optimization tasks.
```

**Or if not installed:**

```
I found a skill that might help!

📦 vercel-react-best-practices
   React and Next.js performance optimization guidelines from Vercel Engineering.

To install it, run:
  xopcbot skills install vercel-react-best-practices

Or manually:
  mkdir -p ~/.xopcbot/workspace/skills/vercel-react-best-practices
  curl -L https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/vercel-react-best-practices/SKILL.md \
    -o ~/.xopcbot/workspace/skills/vercel-react-best-practices/SKILL.md

Learn more: https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
```

### Step 5: Offer to Install

If the user wants to proceed, you can help them install:

```bash
# For xopcbot skills with install specs
xopcbot skills install <skill-name> -y

# For GitHub skills (automated)
mkdir -p ~/.xopcbot/workspace/skills/<skill-name>
curl -L <skill-url>/SKILL.md -o ~/.xopcbot/workspace/skills/<skill-name>/SKILL.md
```

## Common Skill Categories

| Category        | Example Queries                          | Popular Skills                    |
| --------------- | ---------------------------------------- | --------------------------------- |
| Web Development | react, nextjs, typescript, css, tailwind | vercel-react-best-practices       |
| Testing         | testing, jest, playwright, e2e           | playwright-testing                |
| DevOps          | deploy, docker, kubernetes, ci-cd        | docker-compose, github-actions    |
| Documentation   | docs, readme, changelog, api-docs        | api-documentation                 |
| Code Quality    | review, lint, refactor, best-practices   | code-review-checklist             |
| Design          | ui, ux, design-system, accessibility     | accessibility-checklist           |
| Productivity    | workflow, automation, git                | git-workflow                      |

## Skill Directory Structure

Skills must be installed in the correct directory structure:

```
~/.xopcbot/workspace/skills/
├── <skill-name>/           ← Each skill needs its own directory
│   ├── SKILL.md            ← Required: Skill metadata and instructions
│   ├── config.json         ← Optional: Default configuration
│   └── scripts/            ← Optional: Helper scripts
├── another-skill/
│   └── SKILL.md
└── ...
```

**⚠️ Common Mistake:** Don't put SKILL.md directly in `skills/` directory!

**Correct:**
```
~/.xopcbot/workspace/skills/my-skill/SKILL.md
```

**Incorrect:**
```
~/.xopcbot/workspace/skills/SKILL.md  ← Won't be loaded!
```

## Skill Installation Methods

### Method 1: xopcbot Built-in Install (Recommended)

For skills that declare install dependencies:

```bash
# Check what will be installed
xopcbot skills install <skill-name> --dry-run

# Install
xopcbot skills install <skill-name>
```

This method:
- ✅ Automatically installs dependencies (brew, pnpm, go, etc.)
- ✅ Performs security scanning
- ✅ Validates the skill
- ✅ Reports any issues

### Method 2: Manual GitHub Installation

For skills without install specs:

```bash
# 1. Create directory
mkdir -p ~/.xopcbot/workspace/skills/<skill-name>

# 2. Download SKILL.md
curl -L https://raw.githubusercontent.com/<owner>/<repo>/main/skills/<skill-name>/SKILL.md \
  -o ~/.xopcbot/workspace/skills/<skill-name>/SKILL.md

# 3. Verify
xopcbot skills list | grep <skill-name>
```

### Method 3: Git Clone

For complex skills with multiple files:

```bash
# Clone to temp location
git clone <repo-url> /tmp/skill-clone

# Copy skill directory
cp -r /tmp/skill-clone/skills/<skill-name> ~/.xopcbot/workspace/skills/

# Clean up
rm -rf /tmp/skill-clone

# Verify
xopcbot skills status <skill-name>
```

## Troubleshooting

### Skill Not Loading

**Check directory structure:**
```bash
# Should show SKILL.md in a subdirectory
ls -la ~/.xopcbot/workspace/skills/<skill-name>/
```

**Validate SKILL.md format:**
```bash
xopcbot skills test validate ~/.xopcbot/workspace/skills/<skill-name>/SKILL.md
```

**Check for errors:**
```bash
xopcbot skills list --json | jq '.diagnostics'
```

### Installation Failed

**Check dependencies:**
```bash
xopcbot skills status <skill-name>
```

**Manual installation:**
```bash
# If skill requires 'curl'
brew install curl  # macOS
sudo apt-get install curl  # Linux
```

**Retry:**
```bash
xopcbot skills install <skill-name>
```

### Skill Not Working

1. **Check if enabled:**
   ```bash
   xopcbot skills status <skill-name>
   ```

2. **Enable if needed:**
   ```bash
   xopcbot skills enable <skill-name>
   ```

3. **Check configuration:**
   ```bash
   xopcbot skills config <skill-name> --show
   ```

4. **Set API key if required:**
   ```bash
   xopcbot skills config <skill-name> --api-key=YOUR_KEY
   ```

## Examples

### Example 1: User asks about React performance

**User:** "How can I make my React app faster?"

**You:**
1. Check installed skills: `xopcbot skills list | grep -i react`
2. If found: "You have the vercel-react-best-practices skill installed!"
3. If not found: Offer to install it

### Example 2: User wants to add testing capability

**User:** "Can you help me write Playwright tests?"

**You:**
1. Search for testing skills
2. Found: `playwright-testing`
3. Install:
   ```bash
   mkdir -p ~/.xopcbot/workspace/skills/playwright-testing
   curl -L <url>/SKILL.md -o ~/.xopcbot/workspace/skills/playwright-testing/SKILL.md
   ```
4. Verify: `xopcbot skills status playwright-testing`

### Example 3: User wants to browse all skills

**User:** "What skills do you have?"

**You:**
```bash
xopcbot skills list -v
```

Then present the list with descriptions.

## Tips for Effective Skill Management

1. **Always verify installation**: Run `xopcbot skills list` after installing
2. **Check skill status**: Use `xopcbot skills status <name>` for details
3. **Keep skills updated**: Periodically check for skill updates
4. **Review security**: Run `xopcbot skills test security` for audits
5. **Organize workspace**: Keep only needed skills to reduce clutter

## References

- **Skills Marketplace**: https://skills.sh/
- **xopcbot Skills CLI**: `xopcbot skills --help`
- **Skill Format**: SKILL.md frontmatter specification
- **GitHub Skills**: Search "agent-skills" on GitHub
