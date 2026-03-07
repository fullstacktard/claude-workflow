#!/bin/bash
# Rollback agent tools standardization changes
# Usage: ./scripts/rollback-agent-tools.sh <backup-directory>

set -e

if [ -z "$1" ]; then
  echo "ERROR: Backup directory required"
  echo "Usage: ./scripts/rollback-agent-tools.sh <backup-directory>"
  echo ""
  echo "Example:"
  echo "  ./scripts/rollback-agent-tools.sh backlog/.backups/agent-tools-20250124-143022"
  exit 1
fi

BACKUP_DIR="$1"
AGENTS_DIR="templates/.claude/agents"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Agent Tools Rollback${NC}"
echo "=========================================="
echo ""

# Verify backup exists
if [ ! -d "$BACKUP_DIR" ]; then
  echo -e "${RED}ERROR: Backup directory not found: $BACKUP_DIR${NC}"
  exit 1
fi

# Verify backup contains agents directory
BACKUP_AGENTS="$BACKUP_DIR/agents"
if [ ! -d "$BACKUP_AGENTS" ]; then
  echo -e "${RED}ERROR: Backup does not contain agents directory${NC}"
  exit 1
fi

# Count files
BACKUP_COUNT=$(ls -1 "$BACKUP_AGENTS"/*.md 2>/dev/null | wc -l)
echo "Backup contains $BACKUP_COUNT agent files"
echo ""

# Confirm rollback
echo -e "${YELLOW}⚠ WARNING: This will overwrite current agent files${NC}"
echo -e "Target: $AGENTS_DIR"
echo -e "Source: $BACKUP_AGENTS"
echo ""
read -p "Continue with rollback? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo -e "${YELLOW}Rollback cancelled${NC}"
  exit 0
fi

echo ""
echo -e "${YELLOW}Rolling back...${NC}"

# Create safety backup of current state
SAFETY_BACKUP="backlog/.backups/agent-tools-before-rollback-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$SAFETY_BACKUP"
cp -r "$AGENTS_DIR" "$SAFETY_BACKUP/"
echo -e "${GREEN}✓ Safety backup created: $SAFETY_BACKUP${NC}"

# Restore from backup
cp -r "$BACKUP_AGENTS"/* "$AGENTS_DIR/"
echo -e "${GREEN}✓ Files restored from backup${NC}"

# Verify
RESTORED_COUNT=$(ls -1 "$AGENTS_DIR"/*.md 2>/dev/null | wc -l)
echo ""
echo "=========================================="
echo -e "${GREEN}Rollback complete${NC}"
echo "  Restored: $RESTORED_COUNT files"
echo "  Safety backup: $SAFETY_BACKUP"
echo ""
echo -e "${YELLOW}Run validation to verify:${NC}"
echo "  ./scripts/validate-agent-tools.sh"
