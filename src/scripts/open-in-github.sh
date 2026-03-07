#!/bin/bash

# Get the file path from argument
FILE_PATH="$1"

# Get git root directory
GIT_ROOT=$(git rev-parse --show-toplevel)

# Get relative path from git root
REL_PATH=$(realpath --relative-to="$GIT_ROOT" "$FILE_PATH")

# Get current branch
BRANCH=$(git branch --show-current)

# Get GitHub repo URL
REMOTE_URL=$(git remote get-url origin)

# Convert SSH URL to HTTPS GitHub URL
# From: git@github.com:username/repo.git
# To: https://github.com/username/repo
GITHUB_URL=$(echo "$REMOTE_URL" | sed 's/git@github.com:/https:\/\/github.com\//' | sed 's/\.git$//')

# Construct the final URL
FINAL_URL="${GITHUB_URL}/blob/${BRANCH}/${REL_PATH}"

# Open in Chrome
/mnt/c/Program\ Files/Google/Chrome/Application/chrome.exe "$FINAL_URL"
