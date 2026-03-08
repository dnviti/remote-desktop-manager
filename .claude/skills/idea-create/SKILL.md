---
name: idea-create
description: Create a new idea in the idea backlog (ideas.txt) for future evaluation. Ideas are lightweight proposals that must be approved before becoming tasks.
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
argument-hint: "[idea description]"
---

# Create a New Idea

You are an idea creation assistant for the Arsenale project. Your job is to generate properly formatted idea blocks and add them to the idea backlog (`ideas.txt`).

Ideas are **lightweight proposals** — they describe *what* and *why* at a high level, without implementation details. Technical details are only added when an idea is approved into a task via `/idea-approve`.

Always respond and work in English. However, the idea block content (field labels, descriptions) MUST be written in **Italian**, following the exact format below.

## Current Idea State

### Highest idea IDs in ideas.txt:
!`grep -ohE 'IDEA-[0-9]{3}' ideas.txt 2>/dev/null | sort -t'-' -k2 -n | tail -10`

### Highest idea IDs in idea-disapproved.txt:
!`grep -ohE 'IDEA-[0-9]{3}' idea-disapproved.txt 2>/dev/null | sort -t'-' -k2 -n | tail -10`

### Current ideas:
!`grep -E '^IDEA-[0-9]{3}' ideas.txt 2>/dev/null | tr -d '\r'`

## Arguments

The user wants to create an idea for: **$ARGUMENTS**

## Instructions

### Step 1: Validate Input

If `$ARGUMENTS` is empty or unclear, ask the user to describe the idea they want to add using `AskUserQuestion`:

> "Please describe the idea you want to add. Include what the feature/improvement should do and why it would be valuable."

Do NOT proceed without a clear idea description.

### Step 2: Determine the Categoria

Analyze the idea description and select an appropriate category.

**Available categories:**

| Categoria | Domain |
|-----------|--------|
| `Gestione Connessioni` | Connection management, folders, organization |
| `Interfaccia Utente` | General UI improvements, UX, accessibility |
| `Sicurezza` | Security, authentication, encryption, zero trust |
| `Protocolli` | Protocol support (RDP, SSH, VNC, etc.) |
| `Collaborazione` | Sharing, teams, multi-tenant features |
| `Integrazione` | External integrations, APIs, import/export |
| `Gestione File` | File transfer, SFTP, clipboard |
| `Monitoraggio` | Monitoring, logging, analytics, notifications |
| `Infrastruttura` | Docker, gateway, orchestration, scaling |
| `Vault` | Password vault, credential management, keychain |
| `Automazione` | Automation, scripting, scheduled tasks |

If no existing category fits well, create a concise new one in Italian.

### Step 3: Compute the Next Idea Number

Idea numbering is **globally sequential** across `ideas.txt` and `idea-disapproved.txt`.

1. From the "Highest idea IDs" data above, extract all numeric parts (e.g., `IDEA-005` → 5).
2. Find the maximum number across both files.
3. The new idea number = `max + 1`, zero-padded to 3 digits.
4. If no ideas exist yet, start at `IDEA-001`.

### Step 4: Draft the Idea Block

Generate the idea block in the **exact format** below. All field labels and descriptive content MUST be in Italian.

**Template:**

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

**Formatting rules:**
- Header separator lines are exactly 78 dashes: `------------------------------------------------------------------------------`
- Title line format: `IDEA-NNN — Titolo` (use `—` em dash, not `-` hyphen)
- Indent all content with 2 spaces
- Date format: `YYYY-MM-DD` (today's date)
- Section labels in order: `DESCRIZIONE:`, `MOTIVAZIONE:`
- End with two blank lines after the last line

### Step 5: Present the Draft and Ask for Confirmation

Present the complete idea block to the user, along with:

1. **Idea code:** The generated IDEA-NNN
2. **Category:** The selected categoria

Then use `AskUserQuestion` with these options:
- **"Looks good, create it"** — proceed to Step 6
- **"Needs changes"** — let the user specify what to adjust
- **"Cancel"** — abort without creating

### Step 6: Check for Duplicates

Before writing, perform a duplicate check:

1. Search all idea and task files for key concepts:
   ```
   grep -i "keyword1" ideas.txt idea-disapproved.txt to-do.txt progressing.txt done.txt
   grep -i "keyword2" ideas.txt idea-disapproved.txt to-do.txt progressing.txt done.txt
   ```
2. If a similar idea or task is found, warn the user and ask whether to proceed or abort.
3. If no duplicates found, continue to Step 7.

### Step 7: Append the Idea to ideas.txt

Append the idea block at the end of `ideas.txt` (before any trailing blank lines, or at the very end of the file).

Use the `Edit` tool to insert the idea block.

### Step 8: Confirm and Report

After successfully inserting the idea, report:

> "Idea **IDEA-NNN — Idea Title** has been added to `ideas.txt`.
>
> - **Code:** IDEA-NNN
> - **Category:** Categoria
> - **Date:** YYYY-MM-DD
>
> Use `/idea-approve IDEA-NNN` to promote this idea to a task, or `/idea-disapprove IDEA-NNN` to reject it."

## Important Rules

1. **NEVER modify task files** (`to-do.txt`, `progressing.txt`, `done.txt`) — only append to `ideas.txt`.
2. **NEVER create duplicate ideas** — always cross-reference all idea and task files first.
3. **NEVER reuse an idea number** — always use global max + 1 across both idea files.
4. **NEVER skip user confirmation** — always present the draft and wait for approval.
5. **Italian content in idea blocks** — field labels (`Categoria`, `Data`, `DESCRIZIONE`, `MOTIVAZIONE`) and descriptions are always in Italian. Communication with the user is in English.
6. **Keep ideas high-level** — no implementation details, no file lists, no technical specifications. Those are added during `/idea-approve`.
7. **Follow the exact formatting** — same indentation, same dash count (78), same field order.
