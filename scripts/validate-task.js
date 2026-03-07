#!/usr/bin/env node

// src/templates/scripts/validate-task.ts
import fs from "node:fs";
function validateTask(taskFile2) {
  if (typeof taskFile2 !== "string" || taskFile2 === "") {
    console.error("Usage: node scripts/validate-task.js <task-file>");
    return false;
  }
  if (!fs.existsSync(taskFile2)) {
    console.log(`Task file not found (possibly deleted): ${taskFile2} - skipping validation`);
    return true;
  }
  const content = fs.readFileSync(taskFile2, "utf8");
  const checks = [
    { message: "Task must start with YAML frontmatter (---)", pattern: /^---\n/ },
    { message: "Task must have an id in format: task-XXX", pattern: /id:\s*task-\d+/ },
    { message: "Task must have a title", pattern: /title:/ },
    { message: "Task must have a status", pattern: /status:/ },
    { message: "Task must have a Description section", pattern: /## Description/ },
    { message: "Task must have Acceptance Criteria section", pattern: /## Acceptance Criteria/ }
  ];
  const errors = [];
  for (const check of checks) {
    if (!check.pattern.test(content)) {
      errors.push(check.message);
    }
  }
  if (errors.length > 0) {
    console.error("Task validation failed:");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    return false;
  }
  console.log("\u2705 Task validation passed");
  return true;
}
var taskFile = process.argv[2];
if (!validateTask(taskFile)) {
  process.exit(1);
}
