# Skills System Guide

XOPC's skills system is file-based: add domain-specific capabilities and knowledge to your assistant through `SKILL.md` files in the workspace.

## Table of Contents

- [What is a Skill](#what-is-a-skill)
- [SKILL.md File Format](#skillmd-file-format)
- [Skill Sources](#skill-sources)
- [Skills Hub (git / archives)](#skills-hub-git--archives)
- [Agent runtime: tools](#agent-runtime-tools)
- [Declaring environment variables](#declaring-environment-variables)
- [CLI Commands](#cli-commands)
- [Configure Skills](#configure-skills)
- [Install Skill Dependencies](#install-skill-dependencies)
- [Security Scanning](#security-scanning)
- [Skill Testing](#skill-testing)
- [Example Skills](#example-skills)

## What is a Skill

A Skill is a directory containing:

- `SKILL.md` - Skill metadata and documentation (required)
- Scripts, config files, resource files, etc. (optional)

Skills help the AI assistant:
- Understand domain-specific knowledge and best practices
- Use specific CLI tools and APIs
- Follow specific workflows and conventions

## SKILL.md File Format

SKILL.md uses YAML frontmatter for metadata, followed by detailed documentation in Markdown format.

### Basic Structure

```markdown
---
name: skill-name
description: Short description of the skill
homepage: https://example.com
metadata:
  xopc:
    emoji: 📦
    os: [darwin, linux]
    requires:
      bins: [curl, jq]
    install:
      - id: brew-curl
        kind: brew
        formula: curl
        bins: [curl]
        label: Install curl (brew)
---

# Skill Name

Detailed explanation of how to use this skill...
```

### Frontmatter Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Skill name (unique identifier) |
| `description` | string | Short description of the skill |
| `homepage` | string | Project homepage URL |
| `metadata.xopc.emoji` | string | Icon displayed in UI |
| `metadata.xopc.os` | string[] | Supported operating systems: `darwin`, `linux`, `win32` |
| `metadata.xopc.requires` | object | Dependency requirements |
| `metadata.xopc.requires.bins` | string[] | Required binaries |
| `metadata.xopc.requires.anyBins` | string[] | Any one of the binaries must be available |
| `metadata.xopc.install` | array | List of installation options |

### Installer Types

Supported installer types:

| kind | Description | Required Fields |
|------|-------------|-----------------|
| `brew` | Homebrew package | `formula` |
| `pnpm` | pnpm package | `package` |
| `npm` | npm package | `package` |
| `yarn` | Yarn package | `package` |
| `bun` | Bun package | `package` |
| `go` | Go module | `module` |
| `uv` | Python (uv) | `package` |
| `download` | Direct download | `url` |

### Installer Examples

```yaml
install:
  # Homebrew installation
  - id: brew-curl
    kind: brew
    formula: curl
    bins: [curl]
    label: Install curl (brew)
  
  # npm installation
  - id: pnpm-tool
    kind: pnpm
    package: some-tool
    bins: [some-tool]
    label: Install via pnpm
  
  # Go installation
  - id: go-tool
    kind: go
    module: github.com/user/tool/cmd/tool@latest
    bins: [tool]
    label: Install via Go
```

## Skill Sources

Skills can be loaded from these locations:

1. **Bundled** - Skills built into XOPC
   - Bundled skills ship with the XOPC install.
   
2. **Workspace** - Workspace-specific skills
   - Location: `<workspace>/skills/`
   - Highest priority

3. **Global** - Global skills
   - Location: `~/.xopc/skills/`

4. **Extra** - Extra configured skill directories
   - Specified via config file

### Priority

Workspace > Global > Bundled

Skills loaded later will override earlier ones with the same name.

## Skills Hub (git / archives)

Install or refresh skills from a remote Git repository or a local/remote archive (zip/tar.gz) into **`~/.xopc/skills`**. Provenance and content hashes are recorded in **`skills-lock.json`** next to the skills directory so you can update deterministically.

```bash
# Shallow clone or unpack; optional --ref, --path (subdir with SKILL.md), --id (folder name), --force, --strict-scan
xopc skills hub pull https://github.com/org/repo.git

# Re-fetch a managed skill using the lock file
xopc skills hub update my-skill

# Inspect lock entries
xopc skills hub lock
xopc skills hub lock --json
```

Hub-installed skills behave like **global** skills (same load rules as `~/.xopc/skills/`). Use `skills enable` / `skills disable` and `~/.xopc/skills.json` entries as usual.

## Agent runtime: tools

The agent exposes skill-oriented tools (when a skill manager is wired):

| Tool | Purpose |
|------|---------|
| `skills_list` | Names and descriptions visible in this session (honours allowlists and tool gating). |
| `skill_view` | Read `SKILL.md` or files under `references/`, `templates/`, `scripts/`, `assets/`. |
| `skill_manage` | Create/edit/patch/delete user skills where `skills.agentWritePolicy` allows. |

**`skills.json` (global file)** supports:

| Field | Meaning |
|-------|---------|
| `toolGating` | When true (default), skills that declare required tools/extensions are hidden until those tools are registered. Set `false` to ignore gating. |
| `agentWritePolicy` | Where `skill_manage` may write: `global`, `workspace`, or `both` (default `global`). |
| `limits.maxSkillFileBytes` | Maximum bytes `skill_view` will read per file. |

**SKILL.md frontmatter:**

- `disable-model-invocation: true` — keep the skill installed but exclude it from model-facing lists (`<available_skills>`, `skills_list`, `skill_view` eligibility).

See [Built-in Tools Reference](tools.md) for parameters and limits.

## Declaring environment variables

Declare API keys or other env vars the skill needs so the runtime can register **names** for passthrough (values are never injected into the model). Supported sources (merged, deduped):

- Hermes-style **`required_environment_variables`** array with `{ name: "VAR" }` entries
- **`prerequisites.env_vars`** (list of names)
- **`requires.env`** or **`metadata.xopc.requires.env`**

After a successful **`skill_view`**, declared names are registered for the session; the **`shell`** tool may forward matching variables from the process environment.

## CLI Commands

### List Skills

```bash
# List all available skills
xopc skills list

# Show detailed information
xopc skills list -v

# JSON format output
xopc skills list --json
```

### Install Skill Dependencies

```bash
# Install default dependencies
xopc skills install weather

# Specify installer
xopc skills install weather -i brew-curl

# Dry run (don't actually execute)
xopc skills install weather --dry-run
```

### Enable/Disable Skills

```bash
# Enable skill
xopc skills enable weather

# Disable skill
xopc skills disable weather
```

### View Skill Status

```bash
# View all skills status
xopc skills status

# View specific skill details
xopc skills status weather

# JSON format
xopc skills status --json
```

### Security Audit

```bash
# Audit all skills
xopc skills audit

# Audit specific skill
xopc skills audit weather

# Show detailed findings
xopc skills audit weather --deep
```

### Configure Skill

```bash
# Show current configuration
xopc skills config weather --show

# Set API key
xopc skills config weather --api-key=YOUR_API_KEY

# Set environment variables
xopc skills config weather --env API_KEY=value --env DEBUG=true
```

### Test Skill

```bash
# Test all skills
xopc skills test

# Test specific skill
xopc skills test weather

# Verbose output
xopc skills test --verbose

# JSON format
xopc skills test --format json

# Skip specific tests
xopc skills test --skip-security
xopc skills test --skip-examples

# Validate SKILL.md file
xopc skills test validate ./skills/weather/SKILL.md

# Check dependencies
xopc skills test check-deps

# Security audit
xopc skills test security --deep
```

## Configure Skills

Skill configuration file is located at `~/.xopc/skills.json`. Optional **top-level** keys control loading and agent behaviour (see [Agent runtime](#agent-runtime-tools)); **`entries`** hold per-skill overrides:

```json
{
  "toolGating": true,
  "agentWritePolicy": "global",
  "limits": {
    "maxSkillFileBytes": 1048576
  },
  "entries": {
    "weather": {
      "enabled": true,
      "apiKey": "your-api-key",
      "env": {
        "WTTR_LANG": "en",
        "WTTR_UNITS": "m"
      },
      "config": {
        "defaultLocation": "Beijing"
      }
    }
  }
}
```

### Environment Variable Override

You can override skill configuration using environment variables:

```bash
# Enable/disable
export XOPC_SKILL_WEATHER_ENABLED=true

# API key
export XOPC_SKILL_WEATHER_API_KEY=your-key

# Environment variables
export XOPC_SKILL_WEATHER_ENV_WTTR_LANG=en
```

## Install Skill Dependencies

Skills may depend on external tools. Use `skills install` command to install:

```bash
# View skill dependencies
xopc skills status weather

# Install dependencies
xopc skills install weather
```

Supported installers:
- ✅ Homebrew (macOS/Linux)
- ✅ npm/yarn/bun (Node.js)
- ✅ Go modules
- ✅ uv (Python)
- ⏳ Direct download (in development)

### Installation Flow

1. Parse skill's `install` metadata
2. Check prerequisites (like whether brew, go are installed)
3. Auto-install missing prerequisites (if possible)
4. Execute installation commands
5. Perform security scan
6. Report results and warnings

## Security Scanning

All skills undergo security scanning during installation and loading.

### Scan Contents

**Critical**:
- `exec()` direct command execution
- `eval()` dynamic code execution
- `child_process` module usage
- File write/delete operations
- Network server creation

**Warning**:
- Environment variable access
- Current working directory access
- Command line argument access
- Timer usage

### View Scan Results

```bash
# Quick audit
xopc skills audit weather

# Detailed report
xopc skills audit weather --deep
```

### Example Scan Output

```
Security scan results for "weather":
  Critical: 0
  Warnings: 2
  Info: 0

Findings:
  ⚠️  Environment variable access at line 5
  ⚠️  Console output at line 12
```

## Skill Testing

XOPC provides a complete skill testing framework to verify skill quality, safety, and functionality.

### Test Types

| Test | Description |
|------|-------------|
| SKILL.md format | Validate YAML frontmatter and required fields |
| Dependency check | Check if declared binaries are available |
| Security scan | Scan for dangerous code patterns |
| Metadata integrity | Check optional fields like emoji, homepage |
| Example validation | Validate code block syntax |

### Run Tests

```bash
# Test all skills
xopc skills test

# Test specific skill
xopc skills test weather

# Verbose output
xopc skills test --verbose

# JSON format (for CI/CD)
xopc skills test --format json

# TAP format (for CI/CD)
xopc skills test --format tap

# Strict mode (warnings are also treated as failures)
xopc skills test --strict
```

### Example Test Output

```
Skill Test Results
==================

✅ weather
   SKILL.md format: Valid
   Dependencies: All satisfied
   Security: No issues
   Metadata: Complete
   Examples: 5 code blocks

Summary: 1/1 skills passed
```

### Use in CI/CD

```yaml
# .github/workflows/skills-test.yml
name: Skills Test

on:
  push:
    paths:
      - 'skills/**'
  pull_request:
    paths:
      - 'skills/**'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npm run build
      - run: xopc skills test --format tap --strict
```

## Example Skills

### X/Twitter Growth Ops Skill

`skills/business/x-twitter-growth-ops` is a bundled business skill for founders who want to turn X/Twitter conversations into a weekly operating loop. It covers read-only audience research, tweet and reply search, reply drafting, launch monitors, follower export, media workflows, and giveaway draw planning.

The skill can run as a planning workflow by itself. When an OpenClaw runtime is available, it points the user to TweetClaw for concrete X/Twitter operations:

```bash
openclaw plugins install @xquik/tweetclaw
openclaw config set tools.alsoAllow '["explore", "tweetclaw"]'
openclaw plugins inspect tweetclaw --runtime
```

It also ships reusable templates:

- `templates/weekly-x-twitter-ops.md`
- `templates/openclaw-tweetclaw-setup.md`

### Weather Skill

```markdown
---
name: weather
description: Get weather information using wttr.in
homepage: https://github.com/chubin/wttr.in
metadata:
  xopc:
    emoji: 🌤️
    requires:
      anyBins: [curl, wget]
    install:
      - id: brew-curl
        kind: brew
        formula: curl
        bins: [curl]
        label: Install curl (brew)
---

# Weather Skill

Get weather information using wttr.in.

## Quick Start

```bash
curl wttr.in/Beijing
```

## More Usage

See [wttr.in documentation](https://github.com/chubin/wttr.in)
```

### GitHub Skill

```markdown
---
name: github
description: Interact with GitHub via CLI
homepage: https://cli.github.com
metadata:
  xopc:
    emoji: 🐙
    requires:
      bins: [gh]
    install:
      - id: brew-gh
        kind: brew
        formula: gh
        bins: [gh]
        label: Install GitHub CLI (brew)
---

# GitHub Skill

Interact with GitHub using GitHub CLI (gh).

## Configuration

```bash
gh auth login
```

## Common Commands

```bash
# View PRs
gh pr list

# Create Issue
gh issue create

# View CI status
gh run list
```
```

## Best Practices

### Creating Skills

1. **Clear naming**: Use lowercase, hyphen-separated (e.g., `my-skill`)
2. **Clear description**: One sentence explaining the skill's purpose
3. **Complete documentation**: Include quick start, examples, reference links
4. **Declare dependencies**: Clearly list required binaries
5. **Provide installers**: Offer multiple installation options for users
6. **Platform support**: Declare supported operating systems

### Skill Content

- ✅ Provide CLI command examples
- ✅ Include common use cases
- ✅ List environment variable configuration
- ✅ Provide error handling suggestions
- ✅ Include reference documentation links

### Security Considerations

- Avoid using `eval()` in skill scripts
- Use file write operations carefully
- Clearly declare network access needs
- Provide safe usage examples

### Testing Skills

- Run `skills test` before committing
- Ensure all tests pass
- Fix security scan warnings
- Verify code examples are executable

## Troubleshooting

### Skill Not Loaded

1. Check if SKILL.md file format is correct
2. Confirm skill directory name matches `name` field
3. Check `xopc skills list` output
4. Check for naming conflicts

### Dependency Installation Failed

1. Use `--dry-run` to see installation commands
2. Manually execute installation commands to debug
3. Check if package managers are working
4. Check security scan warnings

### Skill Not Working

1. Check if required binaries are available: `xopc skills status <name>`
2. Confirm skill is enabled: `xopc skills enable <name>`
3. Check configuration: `xopc skills config <name> --show`
4. Check verbose logs: `XOPC_LOG_LEVEL=debug xopc ...`

### Test Failures

```bash
# View verbose output
xopc skills test --verbose

# Skip specific tests
xopc skills test --skip-security

# Only run failed tests (future support)
xopc skills test --bail
```

## References

- [Skill Testing Framework](./skills-testing.md) - Detailed test framework documentation
- [CLI Command Reference](./cli.md) - All available commands

---

_Last updated: 2026-04-11_
