#!/usr/bin/env node

import fs from "node:fs";
// import path from 'path'; // Not currently used

// Validate task template script
// This can be customized per project

interface ValidationCheck {
  message: string;
  pattern: RegExp;
}

function validateTask(taskFile: string | undefined): boolean {
  if (typeof taskFile !== "string" || taskFile === "") {

    console.error("Usage: node scripts/validate-task.js <task-file>");
    return false;
  }

  if (!fs.existsSync(taskFile)) {
    // Silently succeed for deleted files (pre-commit hook should filter these)

    console.log(`Task file not found (possibly deleted): ${taskFile} - skipping validation`);
    return true;
  }

  const content = fs.readFileSync(taskFile, "utf8");

  // Basic validation checks
  const checks: ValidationCheck[] = [
    { message: "Task must start with YAML frontmatter (---)", pattern: /^---\n/ },
    { message: "Task must have an id in format: task-XXX", pattern: /id:\s*task-\d+/ },
    { message: "Task must have a title", pattern: /title:/ },
    { message: "Task must have a status", pattern: /status:/ },
    { message: "Task must have a Description section", pattern: /## Description/ },
    { message: "Task must have Acceptance Criteria section", pattern: /## Acceptance Criteria/ },
  ];

  const errors: string[] = [];

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

  console.log("✅ Task validation passed");
  return true;
}

// Main execution

const taskFile = process.argv[2];
if (!validateTask(taskFile)) {
  
   
   
  process.exit(1);
}