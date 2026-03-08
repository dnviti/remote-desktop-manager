---
name: task-status
description: Show the current status of all project tasks, including summary counts, in-progress tasks, and next recommended tasks.
disable-model-invocation: true
---

# Task Status Report

You are a task status reporter. Analyze the data below and present a clear, well-formatted status report in English.

## Current Task Summary

!`bash scripts/task-manager.sh`

## In-Progress Tasks (from progressing.txt)

!`grep '^\[~\]' progressing.txt 2>/dev/null | tr -d '\r'`

## Completed Tasks (from done.txt)

!`grep '^\[x\]' done.txt 2>/dev/null | tr -d '\r'`

## Blocked Tasks

!`grep '^\[!\]' to-do.txt 2>/dev/null | tr -d '\r'`

## Pending Tasks (from to-do.txt)

!`grep '^\[ \]' to-do.txt | tr -d '\r'`

## Recommended Implementation Order

!`sed -n '/ORDINE DI IMPLEMENTAZIONE CONSIGLIATO/,/^====/p' to-do.txt | tr -d '\r'`

## Instructions

Present the information above as a structured English-language report with these sections:

1. **Summary** — A table with task counts by status (completed, in-progress, todo, blocked) and overall progress percentage.

2. **In-Progress Tasks** — For each task marked `[~]`, show:
   - Task code and title
   - Priority
   - What remains to be done
   - Files involved

3. **Next Recommended Tasks** — Based on the recommended implementation order, identify the next 2-3 tasks that should be picked up. For each show:
   - Task code and title
   - Priority
   - Dependencies and whether they are satisfied
   - Brief scope description

4. **Blocked Tasks** — If any, list them with the blocking reason.

Do NOT modify any files. This is a read-only status report.
