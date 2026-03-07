#!/bin/bash
# Standardize agent tools configuration to tools: "*"
# Updates all agent files in templates/.claude/agents/

set -e  # Exit on any error

AGENTS_DIR="templates/.claude/agents"
BACKUP_DIR="backlog/.backups/agent-tools-$(date +%Y%m%d-%H%M%S)"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Agent Tools Standardization Script${NC}"
echo "=========================================="
echo ""

# Create backup directory
echo -e "${YELLOW}Creating backup...${NC}"
mkdir -p "$BACKUP_DIR"
cp -r "$AGENTS_DIR" "$BACKUP_DIR/"
echo -e "${GREEN}✓ Backup created at: $BACKUP_DIR${NC}"
echo ""

# Count agents
TOTAL_AGENTS=$(ls -1 "$AGENTS_DIR"/*.md 2>/dev/null | wc -l)
echo "Found $TOTAL_AGENTS agent files"
echo ""

# Track changes
UPDATED=0
ADDED=0
SKIPPED=0

cd "$AGENTS_DIR"

for file in *.md; do
  if [ ! -f "$file" ]; then
    continue
  fi

  echo -e "${YELLOW}Processing: $file${NC}"

  # Check current state
  if grep -q '^tools: "\*"' "$file"; then
    echo -e "  ${GREEN}✓ Already has tools: \"*\" - skipping${NC}"
    ((SKIPPED++))
  elif grep -q "^tools:" "$file"; then
    # Has tools field but not "*" - update it
    echo -e "  → Updating existing tools field..."
    sed -i 's/^tools:.*$/tools: "*"/' "$file"
    echo -e "  ${GREEN}✓ Updated tools field${NC}"
    ((UPDATED++))
  else
    # Missing tools field - add after color line (or description if no color)
    echo -e "  → Adding tools field..."

    # Try to add after color line first
    if grep -q "^color:" "$file"; then
      sed -i '/^color:/a tools: "*"' "$file"
    else
      # Fallback: add after description line
      sed -i '/^description:/a tools: "*"' "$file"
    fi

    # Also add model field if missing
    if ! grep -q "^model:" "$file"; then
      sed -i '/^tools:/a model: inherit' "$file"
      echo -e "  ${GREEN}✓ Added tools and model fields${NC}"
    else
      echo -e "  ${GREEN}✓ Added tools field${NC}"
    fi

    ((ADDED++))
  fi

  echo ""
done

# Summary
echo "=========================================="
echo -e "${GREEN}Summary:${NC}"
echo "  Total agents: $TOTAL_AGENTS"
echo "  Updated (changed tools): $UPDATED"
echo "  Added (new tools field): $ADDED"
echo "  Skipped (already correct): $SKIPPED"
echo ""
echo -e "${GREEN}✓ All agents now use tools: \"*\"${NC}"
echo ""
echo -e "${YELLOW}Backup location:${NC} $BACKUP_DIR"
echo -e "${YELLOW}To rollback:${NC} ./scripts/rollback-agent-tools.sh $BACKUP_DIR"
