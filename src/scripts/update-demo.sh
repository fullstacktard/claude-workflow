#!/bin/bash

# Script to record and publish VHS demo, then update README with new URL
set -e

echo " Recording demo..."
vhs demo.tape

echo " Publishing to vhs.charm.sh..."
# Capture the output which contains the URL
OUTPUT=$(vhs publish demo.tape)

# Extract the URL from the output (format: "https://vhs.charm.sh/vhs-XXXXX.gif")
NEW_URL=$(echo "$OUTPUT" | grep -o 'https://vhs.charm.sh/vhs-[^[:space:]]*\.gif' | head -1)

if [ -z "$NEW_URL" ]; then
    echo " Failed to extract URL from vhs publish output"
    exit 1
fi

echo " Published to: $NEW_URL"

# Update README.md
echo "Updating README.md..."
sed -i.bak "s|https://vhs.charm.sh/vhs-[^\"]*\.gif|$NEW_URL|g" README.md
rm README.md.bak

# Update README-npm.md if it exists
if [ -f README-npm.md ]; then
    echo "Updating README-npm.md..."
    sed -i.bak "s|https://vhs.charm.sh/vhs-[^\"]*\.gif|$NEW_URL|g" README-npm.md
    rm README-npm.md.bak
fi

echo ""
echo " Demo updated successfully!"
echo "   New URL: $NEW_URL"
echo ""
echo " Don't forget to commit the changes:"
echo "   git add README.md demo.gif"
echo "   git commit -m 'Update demo video'"
