---
name: idea-create
description: Create a new idea in the idea backlog (ideas.txt or GitHub Issues) for future evaluation. Ideas are lightweight proposals that must be approved before becoming tasks.
disable-model-invocation: true
argument-hint: "[idea description]"
---

# Create a New Idea

You are an idea creation assistant for the Arsenale project. Your job is to generate properly formatted idea blocks and add them to the idea backlog.

Ideas are **lightweight proposals** — they describe *what* and *why* at a high level, without implementation details. Technical details are only added when an idea is approved into a task via `/idea-approve`.

Always respond and work in English. However, in local/dual mode, the idea block content (field labels, descriptions) MUST be written in **Italian**, following the exact format below. In GitHub-only mode, all content MUST be in **English**.

## Mode Detection

```bash
TRACKER_CFG=".claude/issues-tracker.json"; [ ! -f "$TRACKER_CFG" ] && TRACKER_CFG=".claude/github-issues.json"
PLATFORM="$(jq -r '.platform // "github"' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_ENABLED="$(jq -r '.enabled // false' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_SYNC="$(jq -r '.sync // false' "$TRACKER_CFG" 2>/dev/null)"
TRACKER_REPO="$(jq -r '.repo' "$TRACKER_CFG" 2>/dev/null)"
```

- **Platform-only mode** (`TRACKER_ENABLED=true` AND `TRACKER_SYNC != true`): Create ideas as GitHub Issues only. No local file operations.
- **Dual sync mode** (`TRACKER_ENABLED=true` AND `TRACKER_SYNC=true`): Write to `ideas.txt` first, then sync to GitHub.
- **Local only mode** (`TRACKER_ENABLED=false` or config missing): Write to `ideas.txt` only.

## Current Idea State

### GitHub-only mode — existing idea IDs:

```bash
gh issue list --repo "$TRACKER_REPO" --label idea --state all --limit 500 --json title --jq '.[].title' 2>/dev/null | grep -oE 'IDEA-[0-9]{3}' | sort -t'-' -k2 -n | tail -10
```

### Local/Dual mode — highest idea IDs in ideas.txt:
!`grep -ohE 'IDEA-[0-9]{3}' ideas.txt 2>/dev/null | sort -t'-' -k2 -n | tail -10`

### Local/Dual mode — highest idea IDs in idea-disapproved.txt:
!`grep -ohE 'IDEA-[0-9]{3}' idea-disapproved.txt 2>/dev/null | sort -t'-' -k2 -n | tail -10`

### Local/Dual mode — current ideas:
!`grep -E '^IDEA-[0-9]{3}' ideas.txt 2>/dev/null | tr -d '\r'`

## Arguments

The user wants to create an idea for: **$ARGUMENTS**

## Instructions

### Step 1: Validate Input

If `$ARGUMENTS` is empty or unclear, ask the user to describe the idea they want to add using `AskUserQuestion`:

> "Please describe the idea you want to add. Include what the feature/improvement should do and why it would be valuable."

Do NOT proceed without a clear idea description.

### Step 2: Determine the Category

Analyze the idea description and select an appropriate category.

**Available categories:**

| Category | Domain |
|----------|--------|
| `Connection Management` | Connection management, folders, organization |
| `User Interface` | General UI improvements, UX, accessibility |
| `Security` | Security, authentication, encryption, zero trust |
| `Protocols` | Protocol support (RDP, SSH, VNC, etc.) |
| `Collaboration` | Sharing, teams, multi-tenant features |
| `Integration` | External integrations, APIs, import/export |
| `File Management` | File transfer, SFTP, clipboard |
| `Monitoring` | Monitoring, logging, analytics, notifications |
| `Infrastructure` | Docker, gateway, orchestration, scaling |
| `Vault` | Password vault, credential management, keychain |
| `Automation` | Automation, scripting, scheduled tasks |

If no existing category fits well, create a concise new one in English.

**Note:** In local/dual mode, use the Italian category names instead: `Gestione Connessioni`, `Interfaccia Utente`, `Sicurezza`, `Protocolli`, `Collaborazione`, `Integrazione`, `Gestione File`, `Monitoraggio`, `Infrastruttura`, `Vault`, `Automazione`.

### Step 3: Compute the Next Idea Number

Idea numbering is **globally sequential**.

**In GitHub-only mode:**
1. Query all idea IDs: `gh issue list --repo "$TRACKER_REPO" --label idea --state all --limit 500 --json title --jq '.[].title' | grep -oE 'IDEA-[0-9]{3}' | sort -t'-' -k2 -n | tail -5`
2. Find the maximum number.
3. The new idea number = `max + 1`, zero-padded to 3 digits.
4. If no ideas exist yet, start at `IDEA-001`.

**In local/dual mode:**
1. From the "Highest idea IDs" data above, extract all numeric parts across both `ideas.txt` and `idea-disapproved.txt`.
2. Find the maximum number across both files.
3. The new idea number = `max + 1`, zero-padded to 3 digits.
4. If no ideas exist yet, start at `IDEA-001`.

### Step 4: Draft the Idea

**In GitHub-only mode**, draft the idea as a GitHub Issue:

**Title:** `[IDEA-NNN] Idea Title (concise, in English)`

**Body:**
```
**Category:** CATEGORY | **Date:** YYYY-MM-DD

## Description
Description of the idea in English. Explain WHAT the idea proposes and the
general context. Keep it high-level, without implementation details.
Approximately 2-6 lines.

## Motivation
Why this idea could be useful. What problem it solves or what value it
adds to the project. Approximately 2-4 lines.

---
*Generated by Claude Code via `/idea-create`*
```

**In local/dual mode**, draft the idea block in Italian:

```
------------------------------------------------------------------------------
IDEA-NNN — Titolo dell'idea (conciso, in italiano)
------------------------------------------------------------------------------
  Categoria: [from Step 2]
  Data: YYYY-MM-DD

  DESCRIZIONE:
  Descrizione dell'idea in italiano. Spiegare COSA propone l'idea e il
  contesto generale. Mantenere alto livello, senza dettagli implementativi.
  Circa 2-6 righe.

  MOTIVAZIONE:
  Perche' questa idea potrebbe essere utile. Quale problema risolve o
  quale valore aggiunge al progetto. Circa 2-4 righe.
```

**Formatting rules for local/dual mode:**
- Header separator lines are exactly 78 dashes: `------------------------------------------------------------------------------`
- Title line format: `IDEA-NNN — Titolo` (use `—` em dash, not `-` hyphen)
- Indent all content with 2 spaces
- Date format: `YYYY-MM-DD` (today's date)
- Section labels in order: `DESCRIZIONE:`, `MOTIVAZIONE:`
- End with two blank lines after the last line

### Step 5: Present the Draft and Ask for Confirmation

Present the complete idea to the user, along with:

1. **Idea code:** The generated IDEA-NNN
2. **Category:** The selected category

Then use `AskUserQuestion` with these options:
- **"Looks good, create it"** — proceed to Step 6
- **"Needs changes"** — let the user specify what to adjust
- **"Cancel"** — abort without creating

### Step 6: Check for Duplicates

Before writing, perform a duplicate check:

**In GitHub-only mode:**
```bash
gh issue list --repo "$TRACKER_REPO" --search "keyword1" --label idea --json number,title --jq '.[] | "#\(.number) \(.title)"'
gh issue list --repo "$TRACKER_REPO" --search "keyword2" --label task --json number,title --jq '.[] | "#\(.number) \(.title)"'
```

**In local/dual mode:**
```
grep -i "keyword1" ideas.txt idea-disapproved.txt to-do.txt progressing.txt done.txt
grep -i "keyword2" ideas.txt idea-disapproved.txt to-do.txt progressing.txt done.txt
```

If a similar idea or task is found, warn the user and ask whether to proceed or abort.
If no duplicates found, continue to Step 7.

### Step 7: Create the Idea

**In GitHub-only mode:**

Create the GitHub Issue directly:
```bash
ISSUE_URL=$(gh issue create --repo "$TRACKER_REPO" \
  --title "[IDEA-NNN] Idea Title" \
  --body "$IDEA_BODY" \
  --label "claude-code,idea")
```

**In dual sync mode:**

1. Append the idea block to `ideas.txt` using the `Edit` tool.
2. Then create the GitHub Issue (same as above).
3. Extract the issue number: `ISSUE_NUM=$(echo "$ISSUE_URL" | grep -oE '[0-9]+$')`
4. Write `GitHub: #NNN` back to the idea block in `ideas.txt` after the `Data:` line using the `Edit` tool.

**In local only mode:**

Append the idea block to `ideas.txt` using the `Edit` tool.

### Step 8: Confirm and Report

After successfully creating the idea, report:

> "Idea **IDEA-NNN — Idea Title** has been created.
>
> - **Code:** IDEA-NNN
> - **Category:** Category
> - **Date:** YYYY-MM-DD
> - **GitHub Issue:** #NNN (URL) *(only if GitHub issue was created)*
>
> Use `/idea-approve IDEA-NNN` to promote this idea to a task, or `/idea-disapprove IDEA-NNN` to reject it."

## Important Rules

1. **NEVER modify task files** (`to-do.txt`, `progressing.txt`, `done.txt`) — only create ideas.
2. **NEVER create duplicate ideas** — always cross-reference all idea and task sources first.
3. **NEVER reuse an idea number** — always use global max + 1.
4. **NEVER skip user confirmation** — always present the draft and wait for approval.
5. **English content in GitHub-only mode** — all labels, descriptions, and content in English.
6. **Italian content in local/dual mode** — field labels and descriptions in Italian.
7. **Keep ideas high-level** — no implementation details, no file lists, no technical specifications. Those are added during `/idea-approve`.
8. **Follow the exact formatting** — same indentation, same dash count (78), same field order for local mode.
