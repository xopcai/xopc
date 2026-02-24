# Skill Testing Framework Guide

xopcbot provides a complete skill testing framework to verify skill quality, safety, and functionality.

## Table of Contents

- [Quick Start](#quick-start)
- [Test Types](#test-types)
- [CLI Commands](#cli-commands)
- [Test Framework API](#test-framework-api)
- [Writing Skill Tests](#writing-skill-tests)
- [CI/CD Integration](#cicd-integration)
- [Best Practices](#best-practices)

## Quick Start

### Run All Skill Tests

```bash
# Using CLI command
npm run dev -- skills test

# Verbose output
npm run dev -- skills test --verbose

# JSON format
npm run dev -- skills test --format json
```

### Test Single Skill

```bash
# Test specific skill
npm run dev -- skills test weather

# Verbose output
npm run dev -- skills test weather --verbose
```

### Run Unit Tests

```bash
# Run test framework unit tests
npm test src/agent/skills/__tests__/test-framework.test.ts
```

## Test Types

The test framework includes the following test types:

### 1. SKILL.md Format Validation

Validates if SKILL.md file format is correct:

- ✅ YAML frontmatter exists
- ✅ Required fields (name, description) exist
- ✅ Field types are correct
- ✅ Content length is sufficient

**Example output**:
```
✓ SKILL.md format: Valid SKILL.md format
```

### 2. Dependency Check

Checks if skill declared dependencies are satisfied:

- ✅ Required binaries exist
- ✅ At least one of `anyBins` is available
- ✅ Installer configuration is correct

**Example output**:
```
✓ Dependencies: All dependencies satisfied
  - Found binary: node
  - Found binary: curl
```

### 3. Security Scan

Scans skill directory for code security issues:

- ⚠️ Dangerous function usage (exec, eval, etc.)
- ⚠️ File system access
- ⚠️ Network operations
- ⚠️ Environment variable access

**Example output**:
```
✓ Security: No security issues
  - Critical: 0
  - Warnings: 0
  - Info: 0
```

### 4. Metadata Integrity

Checks if skill metadata is complete:

- ✅ Emoji icon
- ✅ Homepage link
- ✅ OS limitations
- ✅ Installer definition

**Example output**:
```
⚠ Metadata: Metadata could be improved
  - Emoji: 🌤️
  - No homepage defined (recommended)
```

### 5. Example Validation

Validates code examples in SKILL.md:

- ✅ Extract code blocks
- ✅ Check Shell syntax
- ✅ Verify command format

**Example output**:
```
✓ Examples: Examples validated
  - Found 5 code block(s)
  - Shell examples: 3
```

## CLI Commands

### Main Test Command

```bash
# Test all skills
xopcbot skills test

# Test specific skill
xopcbot skills test <skill-name>

# Specify skills directory
xopcbot skills test --skills-dir ./my-skills

# Output format (text/json/tap)
xopcbot skills test --format json

# Verbose output
xopcbot skills test --verbose

# Strict mode (warnings are also treated as failures)
xopcbot skills test --strict

# Skip specific tests
xopcbot skills test --skip-security
xopcbot skills test --skip-deps
xopcbot skills test --skip-examples
```

### Validate Command

```bash
# Validate single SKILL.md file
xopcbot skills test validate ./skills/weather/SKILL.md

# Strict mode
xopcbot skills test validate ./skills/weather/SKILL.md --strict
```

### Dependency Check Command

```bash
# Check all skills dependencies
xopcbot skills test check-deps

# Check specific skill
xopcbot skills test check-deps weather
```

### Security Audit Command

```bash
# Audit all skills
xopcbot skills test security

# Audit specific skill
xopcbot skills test security weather

# Verbose output
xopcbot skills test security --deep
```

## Test Framework API

### Basic Usage

```typescript
import { SkillTestFramework } from './agent/skills/test-framework.js';

// Create test framework instance
const framework = new SkillTestFramework({
  skipSecurity: false,      // Whether to skip security tests
  skipDeps: false,          // Whether to skip dependency tests
  skipExamples: false,      // Whether to skip example tests
  strict: false,            // Strict mode
  exampleTimeout: 10000,    // Example test timeout (ms)
});

// Test single skill
const report = await framework.testSkill('/path/to/skill');

console.log(`Passed: ${report.passed}`);
console.log(`Results: ${report.summary.passed}/${report.summary.total}`);

// Access detailed results
for (const result of report.results) {
  console.log(`${result.name}: ${result.status} - ${result.message}`);
  if (result.details) {
    for (const detail of result.details) {
      console.log(`  - ${detail}`);
    }
  }
}
```

### Batch Testing

```typescript
import { SkillTestRunner } from './agent/skills/test-framework.js';

const runner = new SkillTestRunner({
  skillsDir: './skills',
  skipSecurity: false,
  skipDeps: false,
  skipExamples: true,  // Usually skip examples in batch testing
  verbose: true,
});

const { reports, passed } = await runner.run();

console.log(`Tested ${reports.length} skills`);
console.log(`All passed: ${passed}`);
```

### Result Formatting

```typescript
import { 
  formatTestResults,
  formatTestResultsJson,
  formatTestResultsTap,
} from './agent/skills/test-framework.js';

// Text format
const textOutput = formatTestResults(reports, true);
console.log(textOutput);

// JSON format
const jsonOutput = formatTestResultsJson(reports);
console.log(jsonOutput);

// TAP format (for CI/CD)
const tapOutput = formatTestResultsTap(reports);
console.log(tapOutput);
```

## Writing Skill Tests

### Unit Test Example

```typescript
import { describe, it, expect } from 'vitest';
import { SkillTestFramework } from '../test-framework.js';

describe('My Skill Tests', () => {
  it('should have valid SKILL.md format', () => {
    const framework = new SkillTestFramework();
    const result = framework.testSkillMdFormat('./skills/my-skill/SKILL.md');
    
    expect(result.status).toBe('pass');
  });

  it('should have all dependencies', async () => {
    const framework = new SkillTestFramework();
    const metadata = {
      name: 'my-skill',
      description: 'My skill',
      requires: {
        bins: ['node', 'npm'],
      },
    };
    
    const result = await framework.testDependencies(metadata);
    expect(result.status).toBe('pass');
  });
});
```

### Integration Test Example

```typescript
import { describe, it, expect } from 'vitest';
import { SkillTestRunner } from '../test-framework.js';

describe('Skills Integration Tests', () => {
  it('should pass all skills tests', async () => {
    const runner = new SkillTestRunner({
      skillsDir: './skills',
      skipExamples: true,  // Skip slow example tests
    });

    const { reports, passed } = await runner.run();
    
    expect(passed).toBe(true);
    expect(reports.length).toBeGreaterThan(0);
  });
});
```

## CI/CD Integration

### GitHub Actions

The project includes a pre-configured GitHub Actions workflow:

```yaml
# .github/workflows/skills-test.yml
name: Skills Test

on:
  push:
    paths:
      - 'skills/**'
      - 'src/agent/skills/**'
  pull_request:
    paths:
      - 'skills/**'

jobs:
  test-skills:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm install
      - run: npm run build
      - run: xopcbot skills test --verbose
```

### Custom CI Configuration

```yaml
name: Custom Skills Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
      
      - name: Install dependencies
        run: npm install
      
      - name: Build
        run: npm run build
      
      - name: Run skill tests
        run: |
          xopcbot skills test \
            --format tap \
            --skip-examples \
            --strict
      
      - name: Security audit
        run: xopcbot skills test security --deep
```

### Local Regression Testing

```bash
#!/bin/bash
# scripts/test-skills-local.sh

set -e

echo "Running local skill regression tests..."

# Run unit tests
npm test src/agent/skills/__tests__/test-framework.test.ts

# Run integration tests
xopcbot skills test --verbose

# Run security audit
xopcbot skills test security --deep

echo "All tests passed!"
```

## Best Practices

### 1. Test Coverage

Ensure every skill passes these tests:

- ✅ SKILL.md format validation
- ✅ Dependency check
- ✅ Security scan
- ✅ Metadata integrity

### 2. CI/CD Integration

In CI/CD pipeline:

- Run all skill tests
- Enable strict mode
- Block merges on failure
- Generate test reports

### 3. Local Development

When developing skills locally:

```bash
# Quick format validation
xopcbot skills test validate ./skills/my-skill/SKILL.md

# Check dependencies
xopcbot skills test check-deps my-skill

# Full test
xopcbot skills test my-skill --verbose
```

### 4. Performance Optimization

For large number of skills:

```bash
# Skip slow tests
xopcbot skills test --skip-examples

# Only test changed skills (future support)
xopcbot skills test --changed-since HEAD~1
```

### 5. Test Reports

Generate test reports:

```bash
# JSON format (for machine parsing)
xopcbot skills test --format json > test-results.json

# TAP format (for CI/CD)
xopcbot skills test --format tap > test-results.tap

# Verbose text (for human reading)
xopcbot skills test --verbose > test-results.txt
```

## Troubleshooting

### Test Failures

```bash
# View verbose output
xopcbot skills test --verbose

# Skip specific tests
xopcbot skills test --skip-security
```

### Dependency Issues

```bash
# Check all dependencies
xopcbot skills test check-deps

# Install missing dependencies
xopcbot skills install <skill-name>
```

### Security Issues

```bash
# Detailed security audit
xopcbot skills test security --deep

# View specific findings
xopcbot skills audit <skill-name> --deep
```

## Test Output Formats

### Text Format (default)

Human-readable detailed output:

```
Skill Test Results
==================

✅ weather
   SKILL.md format: Valid SKILL.md format
   Dependencies: All dependencies satisfied
   Security: No security issues
   Metadata: Complete
   Examples: 5 code block(s)

Summary: 1/1 skills passed
```

### JSON Format

For machine parsing and CI/CD integration:

```json
{
  "totalSkills": 1,
  "passedSkills": 1,
  "failedSkills": 0,
  "reports": [
    {
      "skillName": "weather",
      "skillPath": "./skills/weather",
      "passed": true,
      "results": [
        {
          "name": "SKILL.md format",
          "status": "pass",
          "message": "Valid SKILL.md format"
        }
      ]
    }
  ]
}
```

### TAP Format

For CI/CD systems using Test Anything Protocol:

```
TAP version 13
1..2
ok 1 - weather/SKILL.md format
ok 2 - weather/Dependencies
```

## References

- [Skills System Guide](./skills.md)
- [Test Framework Source](../src/agent/skills/test-framework.ts)
- [Test Examples](../src/agent/skills/__tests__/test-framework.test.ts)

---

_Last updated: 2026-02-22_
