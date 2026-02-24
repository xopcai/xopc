# Skills System Guide

xopcbot's skills system is , allowing you to add domain-specific capabilities and knowledge to your AI assistant through SKILL.md files.

## Table of Contents

- [What is a Skill](#what-is-a-skill)
- [SKILL.md File Format](#skillmd-file-format)
- [Skill Sources](#skill-sources)
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
  xopcbot:
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
| `metadata.xopcbot.emoji` | string | Icon displayed in UI |
| `metadata.xopcbot.os` | string[] | Supported operating systems: `darwin`, `linux`, `win32` |
| `metadata.xopcbot.requires` | object | Dependency requirements |
| `metadata.xopcbot.requires.bins` | string[] | Required binaries |
| `metadata.xopcbot.requires.anyBins` | string[] | Any one of the binaries must be available |
| `metadata.xopcbot.install` | array | List of installation options |

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
  
  # pnpm installation
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

1. **Bundled** - Skills built into xopcbot
   - Location: `src/agent/skills/bundled/`
   
2. **Workspace** - Workspace-specific skills
   - Location: `<workspace>/skills/`
   - Highest priority

3. **Global** - Global skills
   - Location: `~/.xopcbot/skills/`
   - Location: `~/.agents/skills/`

4. **Extra** - Extra configured skill directories
   - Specified via config file

### Priority

Workspace > Global > Bundled

Skills loaded later will override earlier ones with the same name.

## CLI Commands

### List Skills

```bash
# List all available skills
xopcbot skills list

# Show detailed information
xopcbot skills list -v

# JSON format output
xopcbot skills list --json
```

### Install Skill Dependencies

```bash
# Install default dependencies
xopcbot skills install weather

# Specify installer
xopcbot skills install weather -i brew-curl

# Dry run (don't actually execute)
xopcbot skills install weather --dry-run
```

### Enable/Disable Skills

```bash
# Enable skill
xopcbot skills enable weather

# Disable skill
xopcbot skills disable weather
```

### View Skill Status

```bash
# View all skills status
xopcbot skills status

# View specific skill details
xopcbot skills status weather

# JSON format
xopcbot skills status --json
```

### Security Audit

```bash
# Audit all skills
xopcbot skills audit

# Audit specific skill
xopcbot skills audit weather

# Show detailed findings
xopcbot skills audit weather --deep
```

### Configure Skill

```bash
# Show current configuration
xopcbot skills config weather --show

# Set API key
xopcbot skills config weather --api-key=YOUR_API_KEY

# Set environment variables
xopcbot skills config weather --env API_KEY=value --env DEBUG=true
```

### Test Skill

```bash
# Test all skills
xopcbot skills test

# Test specific skill
xopcbot skills test weather

# Verbose output
xopcbot skills test --verbose

# JSON format
xopcbot skills test --format json

# Skip specific tests
xopcbot skills test --skip-security
xopcbot skills test --skip-examples

# Validate SKILL.md file
xopcbot skills test validate ./skills/weather/SKILL.md

# Check dependencies
xopcbot skills test check-deps

# Security audit
xopcbot skills test security --deep
```

## Configure Skills

Skill configuration file is located at `~/.xopcbot/skills.json`:

```json
{
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
export XOPCBOT_SKILL_WEATHER_ENABLED=true

# API key
export XOPCBOT_SKILL_WEATHER_API_KEY=your-key

# Environment variables
export XOPCBOT_SKILL_WEATHER_ENV_WTTR_LANG=en
```

## Install Skill Dependencies

Skills may depend on external tools. Use `skills install` command to install:

```bash
# View skill dependencies
xopcbot skills status weather

# Install dependencies
xopcbot skills install weather
```

Supported installers:
- ✅ Homebrew (macOS/Linux)
- ✅ pnpm/npm/yarn/bun (Node.js)
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
xopcbot skills audit weather

# Detailed report
xopcbot skills audit weather --deep
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

xopcbot provides a complete skill testing framework to verify skill quality, safety, and functionality.

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
xopcbot skills test

# Test specific skill
xopcbot skills test weather

# Verbose output
xopcbot skills test --verbose

# JSON format (for CI/CD)
xopcbot skills test --format json

# TAP format (for CI/CD)
xopcbot skills test --format tap

# Strict mode (warnings are also treated as failures)
xopcbot skills test --strict
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
      - run: pnpm install
      - run: pnpm run build
      - run: xopcbot skills test --format tap --strict
```

## Example Skills

### Weather Skill

```markdown
---
name: weather
description: Get weather information using wttr.in
homepage: https://github.com/chubin/wttr.in
metadata:
  xopcbot:
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
  xopcbot:
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
3. Check `xopcbot skills list` output
4. Check for naming conflicts

### Dependency Installation Failed

1. Use `--dry-run` to see installation commands
2. Manually execute installation commands to debug
3. Check if package managers are working
4. Check security scan warnings

### Skill Not Working

1. Check if required binaries are available: `xopcbot skills status <name>`
2. Confirm skill is enabled: `xopcbot skills enable <name>`
3. Check configuration: `xopcbot skills config <name> --show`
4. Check verbose logs: `XOPCBOT_LOG_LEVEL=debug xopcbot ...`

### Test Failures

```bash
# View verbose output
xopcbot skills test --verbose

# Skip specific tests
xopcbot skills test --skip-security

# Only run failed tests (future support)
xopcbot skills test --bail
```

## References

- [Skill Testing Framework](./skills-testing.md) - Detailed test framework documentation
- [CLI Command Reference](./cli.md) - All available commands

---

_Last updated: 2026-02-22_
