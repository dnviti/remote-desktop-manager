---
name: release
description: Manage semantic versioning, changelog generation, and git tagging.
disable-model-invocation: true
argument-hint: "[major|minor|patch|stable] or empty for auto-detection"
---

# Release a New Version

You are a release manager for the Arsenale project. Your job is to automate semantic versioning, changelog generation from git history, and git tagging.

Always respond and work in English.

## Current State

### Version and tag info:
!`python3 .claude/scripts/release_manager.py current-version --tag-prefix "v"`

### Current branch:
!`git branch --show-current`

### Working tree status:
!`git status --porcelain | head -5; count=$(git status --porcelain | wc -l); [ "$count" -gt 5 ] && echo "... and $((count - 5)) more files" || true`

## Arguments

The user invoked with: **$ARGUMENTS**

## Instructions

### Platform Detection

!`python3 .claude/scripts/task_manager.py platform-config`

Use the `mode` field to determine behavior: `platform-only`, `dual-sync`, or `local-only`. The JSON includes `platform`, `enabled`, `sync`, `repo`, `cli` (gh/glab), and `labels`.

## Platform Commands

Use `python3 .claude/scripts/task_manager.py platform-cmd <operation> [key=value ...]` to generate the correct CLI command for the detected platform (GitHub/GitLab).

Supported operations: `list-issues`, `search-issues`, `view-issue`, `edit-issue`, `close-issue`, `comment-issue`, `create-issue`, `create-pr`, `list-pr`, `merge-pr`, `create-release`, `edit-release`.

Example: `python3 .claude/scripts/task_manager.py platform-cmd create-issue title="[CODE] Title" body="Description" labels="task,status:todo"`

### Step 1: Pre-flight Checks

**1a. Check for untested tasks:**

Before proceeding with any release, verify that no `status:to-test` tasks exist that could introduce untested code into the release.

**In platform-only or dual sync mode:**
```bash
TOTEST_TASKS=$(gh issue list --repo "$TRACKER_REPO" --label "task,status:to-test" --state open --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null)
# GitLab: glab issue list -R "$TRACKER_REPO" -l "task,status:to-test" --state opened --output json | jq '.[] | "#\(.iid) \(.title)"'
```

If any to-test tasks are found, warn the user:

> "**Warning:** The following tasks are still awaiting testing:
> - [list of to-test tasks]
>
> Their changes may be on the release branch. Consider running `/test-engineer` to complete testing before releasing."

Use `AskUserQuestion` with options:
- **"Continue release anyway"** — proceed to the next check
- **"Abort and test first"** — stop here

STOP HERE after calling `AskUserQuestion`. Do NOT proceed until the user responds.

**In local only mode:** Skip this check (no platform labels to query).

**1b. Check the working tree and branch status** from the "Current State" section above.

**If the working tree is dirty (uncommitted changes):**

Use `AskUserQuestion` with these options:
- **"Commit changes first"** — ask the user for a commit message, then `git add -A && git commit -m "<message>"`
- **"Stash changes"** — run `git stash push -m "pre-release stash"`
- **"Abort release"** — stop here

STOP HERE after calling `AskUserQuestion`. Do NOT proceed until the user responds.

**If the current branch is NOT `develop`:**

Warn the user: "You are on branch `<branch>`, not `develop`. Releases are typically cut from `develop`."

Use `AskUserQuestion` with these options:
- **"Continue on this branch"** — proceed anyway
- **"Switch to develop"** — run `git checkout develop`
- **"Abort release"** — stop here

STOP HERE after calling `AskUserQuestion`. Do NOT proceed until the user responds.

**If the working tree is clean and on `develop`:** proceed to Step 2.

### Step 2: Determine Last Release

Read the `version`, `is_beta`, `base_version`, and `latest_tag` fields from the "Version and tag info" JSON above.

Store:
- `LAST_TAG` — the `latest_tag` value (or empty if `null`)
- `CURRENT_VERSION` — the `version` value
- `IS_BETA` / `BASE_VERSION` — from the JSON fields

### Step 3: Collect and Classify Changes

Run the commit parser:
```bash
python3 .claude/scripts/release_manager.py parse-commits --since "$LAST_TAG"
```
(Omit `--since` if no previous tag exists.)

This returns JSON with:
- `commits[]` — each commit with `prefix`, `description`, `task_code`, `changelog_category`, `is_breaking`
- `summary` — counts: `total`, `features`, `fixes`, `breaking`, `excluded`, `has_meaningful_changes`
- `suggested_bump` — auto-detected bump type (`major`/`minor`/`patch`)

**Cross-reference task titles:** For any `task_code` values in commits, look up the task title for richer changelog entries:
- **In platform-only mode**: Use the platform CLI to search for the task title.
- **In local/dual mode**: Read `done.txt` and extract the task title.

**If `has_meaningful_changes` is `false`:**

Warn the user: "No significant changes detected since the last release. Only maintenance commits found."

Use `AskUserQuestion` with these options:
- **"Release anyway"** — proceed with a patch bump
- **"Abort"** — stop here

STOP HERE after calling `AskUserQuestion`. Do NOT proceed until the user responds.

### Step 4: Suggest Version Bump

#### 4a: Beta promotion check

**If `$ARGUMENTS` is `stable` or `promote`:**

If `IS_BETA` is `false`, warn the user: "No beta version to promote — current version is `CURRENT_VERSION`." and stop.

If `IS_BETA` is `true`, set `NEW_VERSION = BASE_VERSION` and skip to Step 4c.

**If `IS_BETA` is `true` (and `$ARGUMENTS` is NOT `stable`/`promote`):**

The current version is a beta. Present to the user:

> Current version is **CURRENT_VERSION** (beta release).

Use `AskUserQuestion` with these options:
- **"Promote to stable vBASE_VERSION"** — finalize the beta as a stable release
- **"Cancel"** — stop here

STOP HERE after calling `AskUserQuestion`. Do NOT proceed until the user responds.

If promoting: set `NEW_VERSION = BASE_VERSION` and skip to Step 4c.

#### 4b: Compute new version

Run the bump calculator:
```bash
python3 .claude/scripts/release_manager.py suggest-bump --current-version "$CURRENT_VERSION" --suggested-bump "$SUGGESTED_BUMP"
```

If `$ARGUMENTS` contains `major`, `minor`, or `patch`, add `--force $ARGUMENTS` to override auto-detection.

The script handles: version arithmetic, major→beta suffix, reset rules. Read the `new_version` and `bump_type` from the output.

#### 4c: Confirm version

Present to the user:

If the version ends with `-beta`:
> **Version bump:** `CURRENT_VERSION` → `NEW_VERSION` (major beta — N new features, M fixes detected)
> Major releases go through a beta phase first. Run `/release stable` to promote later.

If promoting from beta:
> **Promoting:** `CURRENT_VERSION` → `NEW_VERSION` (beta → stable)

Otherwise:
> **Version bump:** `CURRENT_VERSION` → `NEW_VERSION` (`TYPE` — N new features, M fixes detected)

Use `AskUserQuestion` with these options:
- **"Use vNEW_VERSION"** — proceed with the suggested version
- **"I want a different version"** — wait for the user to specify
- **"Cancel release"** — stop here

STOP HERE after calling `AskUserQuestion`. Do NOT proceed until the user responds.

### Step 5: Generate Changelog Entries

Run the changelog generator by piping the parse-commits output:
```bash
python3 .claude/scripts/release_manager.py parse-commits --since "$LAST_TAG" | python3 .claude/scripts/release_manager.py generate-changelog --version "$NEW_VERSION" --date "$(date +%Y-%m-%d)"
```

This automatically:
- Maps commits to Keep a Changelog categories (Added, Changed, Fixed, Removed, Security)
- Excludes non-user-facing commits (chore, ci, test, docs, style, build)
- Formats entries with task codes where present
- Orders sections: Added > Changed > Fixed > Removed > Security

### Step 6: Confirm Changelog Content

Present the complete generated changelog section to the user:

```
## [X.Y.Z] - YYYY-MM-DD

### Added
- Feature description (TASK-001)
- Another feature

### Fixed
- Bug fix description (TASK-002)
```

Use `AskUserQuestion` with these options:
- **"Looks good, apply it"** — proceed to Step 7
- **"I want to edit it"** — wait for the user to provide corrections, then re-present
- **"Cancel release"** — stop here

STOP HERE after calling `AskUserQuestion`. Do NOT proceed until the user responds.

### Step 7: Update CHANGELOG.md

Read the current `CHANGELOG.md` file.

1. **Insert the new version section** between `## [Unreleased]` and the previous version section. The `## [Unreleased]` line should remain, with an empty line after it, followed by the new version section.

2. **Update the comparison links** at the bottom of the file:
   - Change the `[Unreleased]` link to compare from the new tag:
     ```
     [Unreleased]: https://github.com/dnviti/arsenale/compare/vX.Y.Z...HEAD
     ```
   - Add the new version link comparing to the previous tag (or the initial release tag):
     ```
     [X.Y.Z]: https://github.com/dnviti/arsenale/compare/vPREVIOUS...vX.Y.Z
     ```
   - If this is the first tagged release and no previous tag exists:
     ```
     [X.Y.Z]: https://github.com/dnviti/arsenale/releases/tag/vX.Y.Z
     ```

Use the `Edit` tool to make these changes.

### Step 8: Bump Version in All Manifest Files

Update the version field in all project manifest files:

**Files to update:** `package.json`, `server/package.json`, `client/package.json`

For each file, use the `Edit` tool to replace the old version string with the new one. Target the version field specifically (e.g., `"version": "X.Y.Z"` in package.json).

### Step 9: Confirm Before Commit

Present a summary of all changes:

> **Release summary for vX.Y.Z:**
> - CHANGELOG.md updated with N entries across M categories
> - Version bumped in 3 package.json files
> - Will commit as: `chore(release): vX.Y.Z`

Use `AskUserQuestion` with these options:
- **"Commit"** — proceed to Step 10
- **"Show me the diff first"** — run `git diff` and present it, then ask again
- **"Cancel release"** — revert all changes with `git checkout -- .` and stop

STOP HERE after calling `AskUserQuestion`. Do NOT proceed until the user responds.

### Step 10: Commit

Run `npm run verify` before committing to ensure the release is clean:

```bash
npm run verify
```

If verify fails, present the errors to the user and stop. Do not commit a broken release.

Stage and commit the version bump:

```bash
git add package.json server/package.json client/package.json CHANGELOG.md
git commit -m "chore(release): vX.Y.Z"
```

### Step 11: Publish

After the commit, ask the user whether to publish and tag automatically.

Use `AskUserQuestion` with these options:
- **"Publish and tag automatically"** — proceed to Step 11a
- **"Stop here, I'll do it manually"** — show manual instructions (see below) and stop

STOP HERE after calling `AskUserQuestion`. Do NOT proceed until the user responds.

**If the user chooses "Stop here"**, show the appropriate manual instructions and stop:

**If the release is a beta** (version ends with `-beta`):

> **Beta release vX.Y.Z-beta committed.**
>
> **Manual steps:**
> 1. Run `/git-publish` to push `develop` and create a PR to `main`.
> 2. After the PR merges, tag the release on `main`:
>    ```
>    git fetch origin main
>    git tag -a vX.Y.Z-beta origin/main -m "Release vX.Y.Z-beta"
>    git push origin vX.Y.Z-beta
>    ```
>    Pushing the tag triggers the Release and Docker Build workflows.
> 3. To promote to stable later, run `/release stable`.

**If the release is a promotion from beta:**

> **Release vX.Y.Z promoted from beta.**
>
> **Manual steps:**
> 1. Run `/git-publish` to push `develop` and create a PR to `main`.
> 2. After the PR merges, tag the stable release on `main`:
>    ```
>    git fetch origin main
>    git tag -a vX.Y.Z origin/main -m "Release vX.Y.Z"
>    git push origin vX.Y.Z
>    ```
>    Pushing the tag triggers the Release and Docker Build workflows.

**Otherwise (minor/patch release):**

> **Release vX.Y.Z committed.**
>
> **Manual steps:**
> 1. Run `/git-publish` to push `develop` and create a PR to `main`.
> 2. After the PR merges, tag the release on `main`:
>    ```
>    git fetch origin main
>    git tag -a vX.Y.Z origin/main -m "Release vX.Y.Z"
>    git push origin vX.Y.Z
>    ```
>    Pushing the tag triggers the Release and Docker Build workflows.

**If the user chooses "Publish and tag automatically"**, proceed to Step 11a.

### Step 11a: Push develop

Push the release commit and any tags to origin:

```bash
git push origin develop --tags
```

If this fails, show the error to the user, provide manual instructions, and stop automation.

### Step 11b: Create or reuse Pull Request

Check whether an open PR/MR from `develop` into `main` already exists:

```bash
# GitHub:
gh pr list --base main --head develop --state open --json number,url --jq '.[0]'
# GitLab: glab mr list --target-branch main --source-branch develop --state opened --output json | jq '.[0]'
```

- If a PR/MR already exists, reuse it. Store its URL.
- If no PR/MR exists, create one.

**Check if issues tracker integration is enabled** (uses variables from Platform Detection):

**If `TRACKER_ENABLED` is `true`:**

1. Collect task codes from commits between main and develop:
   ```bash
   TASK_CODES=$(git log main..develop --oneline --no-merges | grep -oE '[A-Z][A-Z0-9]+-[0-9]{3}' | sort -u)
   ```

2. For each task code, find the corresponding issue number:
   ```bash
   # For each code in TASK_CODES:
   # GitHub:
   ISSUE_NUM=$(gh issue list --repo "$TRACKER_REPO" --search "[$CODE] in:title" --label task --json number --jq '.[0].number' 2>/dev/null)
   # GitLab: glab issue list -R "$TRACKER_REPO" --search "[$CODE]" -l task --output json | jq '.[0].iid'
   ```

3. Build the PR/MR body with issue references:
   ```
   ## Changes
   [commit summaries from git log main..develop --oneline --no-merges]

   ## Related Issues
   Refs #N1 ([PREFIX-NNN])
   Refs #N2 ([PREFIX-NNN])

   ---
   *Generated by Claude Code via `/release`*
   ```

4. Create the PR/MR:
   ```bash
   # GitHub:
   gh pr create --base main --head develop \
     --title "Release vX.Y.Z" \
     --body "$PR_BODY"
   # GitLab: glab mr create --target-branch main --source-branch develop --title "Release vX.Y.Z" --description "$PR_BODY"
   ```

**If `TRACKER_ENABLED` is `false` or the config file is missing**, use the simple body:

```bash
# GitHub:
gh pr create --base main --head develop \
  --title "Release vX.Y.Z" \
  --body "Merge develop into main for release vX.Y.Z"
# GitLab: glab mr create --target-branch main --source-branch develop --title "Release vX.Y.Z" --description "Merge develop into main for release vX.Y.Z"
```

Store the returned PR URL.

If PR creation fails, show the error and provide manual instructions. Stop automation.

### Step 11c: Enable auto-merge

```bash
# GitHub:
gh pr merge <PR_URL> --auto --merge
# GitLab: glab mr merge <MR_IID> --auto-merge --when-pipeline-succeeds
```

If this fails with an error about auto-merge not being enabled on the repository, warn the user:

> "Auto-merge is not enabled for this repository.
> Enable it at **Settings → General → Allow auto-merge**, or merge manually.
> I will still poll for the PR to be merged."

Continue to Step 11d regardless — the user may merge manually while we poll.

### Step 11d: Wait for PR merge

Poll the PR/MR status every 15 seconds for up to 10 minutes using a single bash command:

```bash
# GitHub:
TIMEOUT=600
INTERVAL=15
ELAPSED=0
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  STATE=$(gh pr view <PR_URL> --json state --jq '.state')
  if [ "$STATE" = "MERGED" ]; then
    echo "PR_MERGED"
    exit 0
  fi
  if [ "$STATE" = "CLOSED" ]; then
    echo "PR_CLOSED"
    exit 1
  fi
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done
echo "TIMEOUT"
exit 2
# GitLab: glab mr view <MR_IID> --output json | jq -r '.state'
# Note: GitLab states are "merged", "closed", "opened" (not "MERGED")
```

Run this command with a 600000ms timeout.

**If the output is `PR_MERGED`:** Proceed to Step 11e.

**If the output is `PR_CLOSED`:**

> "The PR was closed without merging. Release commit exists on `develop` but was not published to `main`."

Stop automation here.

**If the output is `TIMEOUT`:**

> "The PR has not merged yet — CI may still be running.
> Once it merges, tag the release manually:
> ```
> git fetch origin main
> git tag -a vX.Y.Z origin/main -m "Release vX.Y.Z"
> git push origin vX.Y.Z
> ```"

Stop automation here.

### Step 11e: Tag release on main

After the PR has merged, create and push the release tag:

First check if the tag already exists:

```bash
git tag -l vX.Y.Z
```

If the tag already exists, warn: "Tag `vX.Y.Z` already exists, skipping tag creation." and proceed to Step 11.5.

Otherwise:

```bash
git fetch origin main
git tag -a vX.Y.Z origin/main -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

If tagging or pushing fails, show the error and provide the manual commands. Still proceed to Step 11.5 if the tag exists remotely.

### Step 11.5: Create GitHub Release (if enabled)

Check if GitHub Issues integration is enabled:

```bash
TRACKER_ENABLED="$(jq -r '.enabled // false' .claude/github-issues.json 2>/dev/null)"
```

**If `TRACKER_ENABLED` is `true`:**

Create a GitHub Release with enriched notes:

1. Collect task codes from the changelog entries generated in Step 5.

2. For each task code, find the GitHub issue number:
   ```bash
   TRACKER_REPO="$(jq -r '.repo' .claude/github-issues.json)"
   ISSUE_NUM=$(gh issue list --repo "$TRACKER_REPO" --search "[$CODE] in:title" --label task --json number --jq '.[0].number' 2>/dev/null)
   ```

3. Build enriched release notes:
   ```
   ## What's Changed
   [changelog content from Step 5 — Added, Changed, Fixed, Removed, Security sections]

   ## Issues Resolved
   - #N1 — [PREFIX-NNN] Task title
   - #N2 — [PREFIX-NNN] Task title

   **Full Changelog:** https://github.com/dnviti/arsenale/compare/vPREVIOUS...vX.Y.Z
   ```

4. Create or edit the GitHub Release:
   ```bash
   gh release create "vX.Y.Z" --repo "$TRACKER_REPO" \
     --title "vX.Y.Z" \
     --notes "$RELEASE_NOTES" \
     --target main
   ```
   For beta releases, add `--prerelease`:
   ```bash
   gh release create "vX.Y.Z-beta" --repo "$TRACKER_REPO" \
     --title "vX.Y.Z-beta" \
     --notes "$RELEASE_NOTES" \
     --target main \
     --prerelease
   ```

5. If the release already exists (created by CI), update it instead:
   ```bash
   gh release edit "vX.Y.Z" --repo "$TRACKER_REPO" --notes "$RELEASE_NOTES" 2>/dev/null || true
   ```

**If `TRACKER_ENABLED` is `false` or the file is missing:** Skip this step.

**If `gh` fails:** Warn but do not fail — the local release commit and tag are already done.

### Step 12: Final Report

Present a summary of the completed release:

**If the release is a beta** (version ends with `-beta`):

> **Beta release vX.Y.Z-beta published successfully:**
> - Version bumped in 3 package.json files
> - CHANGELOG.md updated with N entries
> - Commit: `chore(release): vX.Y.Z-beta`
> - PR: <PR_URL> (merged)
> - Tag: `vX.Y.Z-beta` pushed to `main`
> - GitHub Release: created as **prerelease** (if enabled)
> - To promote to stable later, run `/release stable`

**If the release is a promotion from beta:**

> **Release vX.Y.Z promoted and published:**
> - Version bumped from `X.Y.Z-beta` to `X.Y.Z` in 3 package.json files
> - CHANGELOG.md updated
> - PR: <PR_URL> (merged)
> - Tag: `vX.Y.Z` pushed to `main`
> - GitHub Release: created (if enabled)

**Otherwise (minor/patch release):**

> **Release vX.Y.Z published successfully:**
> - Version bumped in 3 package.json files
> - CHANGELOG.md updated with N entries
> - Commit: `chore(release): vX.Y.Z`
> - PR: <PR_URL> (merged)
> - Tag: `vX.Y.Z` pushed to `main`
> - GitHub Release: created (if enabled)

## Important Rules

1. **NEVER skip user confirmation** — always present drafts and wait for approval before writing.
2. **NEVER modify files without showing the user what will change** — always preview changelog entries and version bump before applying.
3. **NEVER create a tag on a dirty working tree** — ensure all changes are committed first.
4. **NEVER reuse a version tag** — if the tag already exists, abort and inform the user.
5. **Exclude non-user-facing commits from the changelog** — `chore:`, `ci:`, `test:`, `docs:`, `style:`, `build:` commits should not appear in the changelog.
6. **Preserve the Keep a Changelog format exactly** — match the structure, link format, and section ordering of the existing `CHANGELOG.md`.
7. **All output must be in English.**
8. **Major releases MUST go through beta first** — a major bump always produces `X.0.0-beta`. The beta stays until the user explicitly runs `/release stable` to promote it.
9. **NEVER promote a non-beta version** — if the current version does not end with `-beta`, the `stable`/`promote` argument must be rejected.
10. **If the user chooses manual publish**, show manual instructions and stop. Do not proceed to the automated publish steps.
