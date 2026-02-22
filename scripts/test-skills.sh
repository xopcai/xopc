#!/usr/bin/env bash
#
# Skills Regression Test Suite
# 
# Run comprehensive tests on all skills
# Usage: ./scripts/test-skills.sh [options]
#
# Options:
#   --skills-dir <path>  Skills directory to test (default: ./skills)
#   --format <format>    Output format: text, json, tap (default: text)
#   --verbose            Show detailed output
#   --strict             Strict mode - fail on warnings
#   --skip-security      Skip security tests
#   --skip-deps          Skip dependency tests
#   --skip-examples      Skip example tests
#   --help               Show this help
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
SKILLS_DIR="./skills"
FORMAT="text"
VERBOSE=""
STRICT=""
SKIP_SECURITY=""
SKIP_DEPS=""
SKIP_EXAMPLES=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --skills-dir)
      SKILLS_DIR="$2"
      shift 2
      ;;
    --format)
      FORMAT="$2"
      shift 2
      ;;
    --verbose)
      VERBOSE="--verbose"
      shift
      ;;
    --strict)
      STRICT="--strict"
      shift
      ;;
    --skip-security)
      SKIP_SECURITY="--skip-security"
      shift
      ;;
    --skip-deps)
      SKIP_DEPS="--skip-deps"
      shift
      ;;
    --skip-examples)
      SKIP_EXAMPLES="--skip-examples"
      shift
      ;;
    --help)
      head -16 "$0" | tail -12 | sed 's/^# //'
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}          xopcbot Skills Regression Test Suite            ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Check if skills directory exists
if [ ! -d "$SKILLS_DIR" ]; then
  echo -e "${RED}✗ Skills directory not found: $SKILLS_DIR${NC}"
  exit 1
fi

# Count skills
SKILL_COUNT=$(find "$SKILLS_DIR" -maxdepth 2 -name "SKILL.md" | wc -l | tr -d ' ')
echo -e "${BLUE}Testing $SKILL_COUNT skill(s) in $SKILLS_DIR${NC}"
echo ""

# Run tests using the CLI
echo -e "${YELLOW}Running comprehensive tests...${NC}"
echo ""

# Build options
OPTIONS=""
if [ -n "$VERBOSE" ]; then OPTIONS="$OPTIONS $VERBOSE"; fi
if [ -n "$STRICT" ]; then OPTIONS="$OPTIONS $STRICT"; fi
if [ -n "$SKIP_SECURITY" ]; then OPTIONS="$OPTIONS $SKIP_SECURITY"; fi
if [ -n "$SKIP_DEPS" ]; then OPTIONS="$OPTIONS $SKIP_DEPS"; fi
if [ -n "$SKIP_EXAMPLES" ]; then OPTIONS="$OPTIONS $SKIP_EXAMPLES"; fi

# Run the test command
if command -v pnpm &> /dev/null; then
  pnpm run dev -- skills test --skills-dir "$SKILLS_DIR" --format "$FORMAT" $OPTIONS
  TEST_EXIT_CODE=$?
elif command -v npx &> /dev/null; then
  npx tsx src/cli/index.ts skills test --skills-dir "$SKILLS_DIR" --format "$FORMAT" $OPTIONS
  TEST_EXIT_CODE=$?
else
  echo -e "${RED}✗ Neither pnpm nor npx found${NC}"
  exit 1
fi

echo ""

# Summary
if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}✓ All skill tests passed!${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
else
  echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${RED}✗ Some skill tests failed${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
fi

exit $TEST_EXIT_CODE
