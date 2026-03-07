#!/bin/bash

# Script to update the public-facing GitHub repo with latest README and package.json
# This maintains a single clean commit in the public repo

set -e

PUBLIC_REPO="/tmp/claude-workflow-public"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo " Updating public repo at github.com/fullstacktard/claude-workflow..."

# Ensure public repo exists
if [ ! -d "$PUBLIC_REPO" ]; then
    echo "📥 Cloning public repo for the first time..."
    cd /tmp
    rm -rf claude-workflow-public
    git clone git@github.com:fullstacktard/claude-workflow.git claude-workflow-public
    cd claude-workflow-public
else
    echo "✓ Public repo directory exists"
    cd "$PUBLIC_REPO"
fi

# Copy latest files
echo "📋 Copying latest README-npm.md, package.json, LICENSE, and .gitattributes..."
cp "$SOURCE_DIR/README-npm.md" "$PUBLIC_REPO/README.md"
cp "$SOURCE_DIR/package.json" "$PUBLIC_REPO/package.json"
cp "$SOURCE_DIR/LICENSE" "$PUBLIC_REPO/LICENSE" 2>/dev/null || echo "No LICENSE file found"
cp "$SOURCE_DIR/.gitattributes" "$PUBLIC_REPO/.gitattributes" 2>/dev/null || echo "No .gitattributes file found"

# Check if anything changed (including untracked files)
if [ -z "$(git status --porcelain)" ]; then
    echo "ℹ️  No changes to push"
    exit 0
fi

# Show what changed
echo ""
echo "📝 Changes:"
git diff --stat

# Commit and force push (maintains single commit)
echo ""
echo " Committing changes..."
git add -A
git commit --amend --no-edit
git push -f origin main

echo ""
echo " Public repo updated successfully!"
echo "🔗 View at: https://github.com/fullstacktard/claude-workflow"
