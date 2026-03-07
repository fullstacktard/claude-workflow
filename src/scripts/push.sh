#!/bin/bash

# Simple push script - commits, pushes to git, and publishes to npm
# Usage: npm run push "commit message"

set -e  # Exit on error

COMMIT_MESSAGE="$1"

if [ -z "$COMMIT_MESSAGE" ]; then
    echo " Error: Please provide a commit message"
    echo "Usage: npm run push \"your commit message\""
    exit 1
fi

echo " Starting push process..."

# Add all changes
echo " Staging changes..."
git add -A

# Commit with provided message
echo " Committing..."
git commit -m "$COMMIT_MESSAGE" || {
    echo "  No changes to commit"
    exit 0
}

# Push to GitHub
echo " Pushing to GitHub..."
git push origin main

# Bump patch version
echo " Bumping version..."
npm version patch --no-git-tag-version

# Commit version bump
git add package.json
git commit -m "Bump version"
git push origin main

# Publish to npm (with public access for unscoped package)
echo "Publishing to npm..."
npm publish --access public

echo ""
echo " Waiting for npm to propagate (10 seconds)..."
sleep 10

# Reinstall package globally to get latest version
echo " Reinstalling package globally..."
npm uninstall -g claude-workflow > /dev/null 2>&1 || true
npm install -g claude-workflow > /dev/null 2>&1

# Record new demo
echo " Recording demo video..."
vhs demo.tape > /dev/null 2>&1

# Publish demo to vhs.charm.sh
echo " Publishing demo to vhs.charm.sh..."
DEMO_URL=$(vhs publish demo.gif 2>&1 | tail -1)

if [ -n "$DEMO_URL" ]; then
    echo " Demo published: $DEMO_URL"

    # Update README files with new demo URL
    echo "Updating README files..."
    OLD_URL=$(grep -o 'https://vhs.charm.sh/vhs-[^"]*\.gif' README.md | head -1)

    if [ -n "$OLD_URL" ]; then
        sed -i "s|$OLD_URL|$DEMO_URL|g" README.md
        sed -i "s|$OLD_URL|$DEMO_URL|g" README-npm.md

        # Commit and push demo changes
        git add README.md README-npm.md
        git commit -m "Update demo video"
        git push origin main

        echo " Demo video updated in READMEs"
    fi
else
    echo "  Failed to publish demo, skipping README update"
fi

echo ""
echo " Push completed successfully!"
echo "   - Changes pushed to GitHub"
echo "   - Package published to npm (public)"
echo "   - Demo video recorded and published"