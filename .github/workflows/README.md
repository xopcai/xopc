# xopcbot Development Workflow Guide

This document describes how to use GitHub Actions and gh-aw for automated development workflows.

## Quick Start

### PR Auto-Check

When you create or update a PR, the following checks run automatically:

1. **Lint Check** - Code style validation
2. **Build Check** - TypeScript compilation
3. **Test Check** - If `/test` tag in PR body

### Comment Commands

| Command | Description |
|---------|-------------|
| `/agent` | Run development agent analysis |
| `/test` | Run specific tests |
| `/docs` | Check documentation updates |
| `/lint` | Run lint check |
| `/build` | Run build check |

## GitHub Actions Workflows

### xopcbot-dev.yml

Located at `.github/workflows/xopcbot-dev.yml`, this workflow provides:

#### Automatic Checks (on PR)

```yaml
on:
  pull_request:
    types: [opened, synchronize]
```

Runs automatically when:
- PR is opened
- New commits are pushed to PR

#### Manual Commands

Use comments to trigger specific agents:

```
/agent    # Full development analysis
/test     # Run tests
/docs     # Check documentation
/lint     # Code style check
/build    # Build verification
```

## gh-aw Integration

### What is gh-aw?

[gh-aw](https://github.com/github/gh-aw) allows writing agentic workflows in natural language markdown.

### Install gh-aw CLI

```bash
# Install as GitHub CLI extension
gh extension install github/gh-aw
```

### Create Custom Workflow

Create `.github/workflows/custom-agent.yml`:

```yaml
name: Custom Agent Workflow

on:
  issue_comment:
    types: [created]

permissions:
  contents: read
  pull-requests: write

agent:
  description: "Your custom agent"
  guardrails:
    readonly: true
    allowedTools: [exec, read]

---

## Your Task Description

Analyze this PR and provide feedback on:
1. Code quality
2. Potential bugs
3. Improvement suggestions
```

## Development Best Practices

### PR Description Template

```markdown
## Summary
Brief description of changes

## Type
- [ ] Bug fix
- [ ] Feature
- [ ] Documentation
- [ ] Refactor

## Testing
- [ ] Tests added
- [ ] Manual testing done

## Notes
Optional notes for reviewers

/test /docs /agent
```

### Running Checks Locally

```bash
# Lint check
npm run lint

# Build check
npm run build

# Run tests
npm test

# Full check
npm run check  # lint + build + test
```

## Troubleshooting

### Workflow Not Triggering

1. Check PR is open and not a draft
2. Verify workflow file is in `.github/workflows/`
3. Check GitHub Actions permissions

### Lint Errors

```bash
# Auto-fix lint errors
npm run lint:fix
```

### Build Errors

```bash
# Check TypeScript errors
npm run build 2>&1 | grep -E "error|Error"
```

## Security

All workflows run with minimal permissions:

- **Contents**: read (for code analysis)
- **Pull-Requests**: write (for comments only)
- **No write access** to code or configuration

## Advanced Usage

### Custom Workflow Triggers

Trigger on specific paths:

```yaml
on:
  pull_request:
    paths:
      - 'src/**/*.ts'
      - '!src/**/*.test.ts'
```

### Scheduled Runs

Add daily health checks:

```yaml
on:
  schedule:
    - cron: '0 9 * * *'  # Daily at 9 AM UTC

jobs:
  daily-health:
    runs-on: ubuntu-latest
    steps:
      - name: Health check
        run: |
          echo "Running daily health check..."
```
