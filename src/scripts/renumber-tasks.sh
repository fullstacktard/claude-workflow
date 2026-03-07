#!/bin/bash
# Renumber duplicate task IDs to unique sequential IDs starting from 400

TASKS_DIR="/home/fullstacktard/development/projects/personal/ai-projects/claude-workflow/backlog/tasks"
counter=400

for file in "$TASKS_DIR"/task-32[2-9]*.md "$TASKS_DIR"/task-33*.md "$TASKS_DIR"/task-34*.md; do
    if [ -f "$file" ]; then
        base=$(basename "$file")
        # Extract the descriptive part after the task number
        desc=$(echo "$base" | sed 's/^task-[0-9]*-//')
        newname="task-${counter}-${desc}"
        mv "$file" "$TASKS_DIR/$newname"
        echo "$base -> $newname"
        counter=$((counter + 1))
    fi
done

echo ""
echo "Renumbered $((counter - 400)) tasks (IDs 400-$((counter - 1)))"
