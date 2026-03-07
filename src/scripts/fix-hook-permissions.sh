#!/bin/bash

# Fix hook permissions for claude-workflow users
# This script recursively makes all .js and .sh files in .claude/hooks executable

set -e

echo "🔧 Fixing hook permissions..."

# Check if .claude/hooks exists
if [ ! -d ".claude/hooks" ]; then
  echo "❌ Error: .claude/hooks directory not found"
  echo "   Please run this script from your project root"
  exit 1
fi

# Count files to fix
total_files=$(find .claude/hooks -type f \( -name "*.js" -o -name "*.sh" \) | wc -l)

if [ "$total_files" -eq 0 ]; then
  echo "ℹ️  No hook files found"
  exit 0
fi

echo "   Found $total_files hook file(s)"

# Make all hook files executable
find .claude/hooks -type f \( -name "*.js" -o -name "*.sh" \) -exec chmod +x {} \;

echo "✅ Fixed permissions for $total_files hook file(s)"
echo ""
echo "You can now use claude-workflow hooks without permission errors!"
