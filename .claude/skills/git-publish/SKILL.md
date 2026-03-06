---
name: git-publish
description: Merge develop into main and push both branches to the remote.
disable-model-invocation: true
allowed-tools: Bash
---

# Publish develop to main

You are a Git operator for the Arsenale project. Your job is to merge `develop` into `main` and push both branches.

## Arguments

The user invoked with: **$ARGUMENTS**

## Instructions

### Step 1: Commit if needed

Check for uncommitted changes:

```bash
git status --porcelain
```

If the working tree is dirty, stage and commit everything:

```bash
git add -A
git commit -m "<message>"
```

Use `$ARGUMENTS` as the commit message. If no arguments were provided, use `"chore: update"` as the default message.

If the working tree is clean, skip this step and proceed to Step 2.

### Step 2: Update and merge

Run the following sequence. If any command fails, stop and report the error.

```bash
git checkout main
git pull origin main
git merge develop
```

If the merge has conflicts, abort with `git merge --abort`, switch back to `develop`, and inform the user about the conflicting files.

### Step 3: Push both branches

```bash
git push origin main
git checkout develop
git push origin develop
```

### Step 4: Report

Confirm success:

> "Published successfully:
> - `develop` merged into `main`
> - Both branches pushed to origin"
