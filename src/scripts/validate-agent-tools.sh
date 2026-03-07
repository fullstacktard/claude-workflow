#!/bin/bash
# Validate all agent files have tools: "*"

set -e

AGENTS_DIR="templates/.claude/agents"
PASSED=0
FAILED=0
MISSING_MODEL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Agent Tools Validation${NC}"
echo "=========================================="
echo ""

cd "$AGENTS_DIR"

for file in *.md; do
  if [ ! -f "$file" ]; then
    continue
  fi

  # Check for tools: "*"
  if grep -q '^tools: "\*"' "$file"; then
    echo -e "${GREEN}✓ $file${NC}"
    ((PASSED++))

    # Also check for model field
    if ! grep -q "^model:" "$file"; then
      echo -e "  ${YELLOW}⚠ Warning: Missing model field${NC}"
      ((MISSING_MODEL++))
    fi
  else
    echo -e "${RED}✗ $file${NC}"
    echo -e "  ${RED}ERROR: Does not have tools: \"*\"${NC}"

    # Show what it has instead
    CURRENT_TOOLS=$(grep "^tools:" "$file" || echo "NO TOOLS FIELD")
    echo -e "  Current: $CURRENT_TOOLS"
    ((FAILED++))
  fi
done

echo ""
echo "=========================================="
echo -e "${GREEN}Results:${NC}"
echo "  Passed: $PASSED"
echo "  Failed: $FAILED"

if [ $MISSING_MODEL -gt 0 ]; then
  echo -e "  ${YELLOW}Missing model field: $MISSING_MODEL${NC}"
fi

echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ All agents have standardized tools configuration${NC}"
  exit 0
else
  echo -e "${RED}✗ Validation failed - fix the above agents${NC}"
  exit 1
fi
