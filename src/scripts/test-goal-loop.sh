#!/bin/bash
# ============================================================================
# Goal Loop System - Integration Test
#
# Creates a temp project, runs claude-workflow init, spawns a goal loop
# with a simple verifiable task, and checks results.
#
# Usage:
#   ./test-goal-loop.sh           # full test (runs claude -p)
#   ./test-goal-loop.sh --dry-run # only tests CLI commands, skips claude -p
#
# Requirements:
#   - claude-workflow installed globally
#   - claude CLI available
#   - Active Claude API auth
# ============================================================================

set -uo pipefail
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:$PATH"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
DRY_RUN=false
TEST_DIR=""

# Parse args
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
  esac
done

pass() {
  echo -e "  ${GREEN}PASS${NC} $1"
  ((PASS++))
}

fail() {
  echo -e "  ${RED}FAIL${NC} $1"
  ((FAIL++))
}

check() {
  local desc="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    pass "$desc"
  else
    fail "$desc"
  fi
}

cleanup() {
  if [ -n "$TEST_DIR" ] && [ -d "$TEST_DIR" ]; then
    echo -e "${DIM}Cleaning up $TEST_DIR${NC}"
    rm -rf "$TEST_DIR"
  fi
}

trap cleanup EXIT

# ── Setup ───────────────────────────────────────────────────────
echo -e "${BOLD}============================================${NC}"
echo -e "${BOLD}  Goal Loop System - Integration Test${NC}"
if $DRY_RUN; then
  echo -e "${YELLOW}  (dry run - skipping claude -p)${NC}"
fi
echo -e "${BOLD}============================================${NC}"
echo ""

TEST_DIR=$(mktemp -d /tmp/goal-test-XXXXXX)
echo -e "${DIM}Test directory: $TEST_DIR${NC}"
echo ""

# Init git repo + claude-workflow
cd "$TEST_DIR"
git init -q
echo "node_modules" > .gitignore
git add . && git commit -q -m "init"

echo -e "${YELLOW}Running claude-workflow init...${NC}"
claude-workflow init --non-interactive > /dev/null 2>&1
echo -e "${GREEN}Init complete${NC}"
echo ""

# ── Test 1: Pre-flight ─────────────────────────────────────────
echo -e "${YELLOW}Test 1: Pre-flight checks${NC}"
check "claude-workflow is installed" which claude-workflow
check "claude CLI is available" which claude
check ".claude directory exists" test -d .claude
check "hooks directory exists" test -d .claude/hooks
check "goal-context-restore hook exists" test -f .claude/hooks/recovery/goal-context-restore.js
check "goal-progress-checkpoint hook exists" test -f .claude/hooks/tracking/goal-progress-checkpoint.js
echo ""

# ── Test 2: CLI commands ───────────────────────────────────────
echo -e "${YELLOW}Test 2: CLI commands (no active goal)${NC}"
check "--status works" bash -c "claude-workflow goal --status 2>&1 | grep -q 'No active goal'"
check "--history works" bash -c "claude-workflow goal --history 2>&1 | grep -q 'No goals found'"
check "--help shows usage" bash -c "claude-workflow goal 2>&1 | grep -q 'Usage:'"
check "--abort with no goal" bash -c "claude-workflow goal --abort 2>&1 | grep -q 'No active goal'"
check "--resume with no goal" bash -c "claude-workflow goal --resume 2>&1; true"
echo ""

if $DRY_RUN; then
  echo -e "${YELLOW}Skipping goal execution (--dry-run)${NC}"
  echo ""
  echo -e "${BOLD}============================================${NC}"
  echo -e "${GREEN}  DRY RUN: $PASS CHECKS PASSED, $FAIL FAILED${NC}"
  echo -e "${BOLD}============================================${NC}"
  exit $FAIL
fi

# ── Test 3: Run a goal ─────────────────────────────────────────
echo -e "${YELLOW}Test 3: Running goal loop...${NC}"
echo -e "${DIM}  Task: Create hello.txt + sum.js + sum.test.js${NC}"
echo ""

GOAL_TEXT="Create these files in the project root:
1. hello.txt - containing exactly the text: Hello from Goal Loop
2. sum.js - a CommonJS module that exports a function add(a, b) that returns a+b
3. sum.test.js - a test file using Node assert that tests add(2,3)===5, add(-1,1)===0, add(0,0)===0. Run with: node sum.test.js

After creating all files, run 'node sum.test.js' to verify it passes."

claude-workflow goal --max-attempts 3 --timeout 5m "$GOAL_TEXT" 2>&1 | while IFS= read -r line; do
  echo -e "${DIM}  | ${line}${NC}"
done

echo ""

# ── Test 4: Verify results ─────────────────────────────────────
echo -e "${YELLOW}Test 4: Verifying created files${NC}"

check "hello.txt exists" test -f hello.txt
check "hello.txt content" bash -c "grep -q 'Hello from Goal Loop' hello.txt"
check "sum.js exists" test -f sum.js
check "sum.js has add function" bash -c "grep -q 'add' sum.js"
check "sum.test.js exists" test -f sum.test.js
check "tests pass" node sum.test.js
echo ""

# ── Test 5: Goal state ─────────────────────────────────────────
echo -e "${YELLOW}Test 5: Goal state persistence${NC}"

check ".claude/goals/ exists" test -d .claude/goals
check "goal state file exists" bash -c "ls .claude/goals/goal-*.json 2>/dev/null | head -1"
check "active.json cleaned up" bash -c "! test -f .claude/goals/active.json"
check "no goal.md" bash -c "! test -f .claude/goal.md"

GOAL_FILE=$(ls -t .claude/goals/goal-*.json 2>/dev/null | head -1)
if [ -n "$GOAL_FILE" ]; then
  check "status is completed" bash -c "grep -q '\"status\":.*\"completed\"' '$GOAL_FILE'"
  check "has attempts" bash -c "grep -q 'attempt_number' '$GOAL_FILE'"

  ATTEMPTS=$(grep -c 'attempt_number' "$GOAL_FILE" 2>/dev/null || echo 0)
  echo -e "  ${DIM}Completed in $ATTEMPTS attempt(s)${NC}"
else
  fail "no goal state file found"
fi
echo ""

# ── Test 6: Post-completion ────────────────────────────────────
echo -e "${YELLOW}Test 6: Post-completion commands${NC}"

check "--history shows completed" bash -c "claude-workflow goal --history 2>&1 | grep -q 'completed'"
check "--status shows no active" bash -c "claude-workflow goal --status 2>&1 | grep -q 'No active goal'"
echo ""

# ── Summary ────────────────────────────────────────────────────
echo -e "${BOLD}============================================${NC}"
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}  ALL $TOTAL TESTS PASSED${NC}"
else
  echo -e "${RED}  $FAIL/$TOTAL TESTS FAILED${NC}"
fi
echo -e "${BOLD}============================================${NC}"

exit $FAIL
