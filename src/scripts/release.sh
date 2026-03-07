#!/bin/bash

# Release script for fst-claude-config
# Combines git push and npm publish into one command

set -e  # Exit on error

echo " Starting release process..."

# Check if working directory is clean
if [ -n "$(git status --porcelain)" ]; then
    echo " Error: Working directory is not clean. Please commit or stash changes first."
    exit 1
fi

# Check if on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo " Error: Not on main branch. Currently on: $CURRENT_BRANCH"
    echo "Please switch to main branch: git checkout main"
    exit 1
fi

# Pull latest changes
echo "📥 Pulling latest changes from main..."
git pull origin main

# Bump version (patch by default, or pass major/minor/patch as argument)
VERSION_TYPE=${1:-patch}
echo " Bumping version ($VERSION_TYPE)..."
NEW_VERSION=$(npm version $VERSION_TYPE --no-git-tag-version)

# Commit version bump
echo " Committing version bump..."
git add package.json
# Add package-lock.json if it exists
if [ -f "package-lock.json" ]; then
    git add package-lock.json
fi
git commit -m "Release $NEW_VERSION"

# Push to GitHub
echo " Pushing to GitHub..."
git push origin main

# Publish to npm
echo "Publishing to npm..."
npm publish

echo ""
echo " Release $NEW_VERSION completed successfully!"
echo "   - Git repository updated"
echo "   - Package published to npm"