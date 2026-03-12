#!/usr/bin/env python3
"""Task and idea manager CLI for claude-task-development-framework.

Provides deterministic file operations for Claude Code skills:
- Task/idea listing, parsing, ID computation
- Block moving between files, removal
- Duplicate detection, file verification
- PostToolUse hook for file-to-task correlation

All output is JSON (default) or formatted text (--format text).
Zero external dependencies — stdlib only.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# ── Constants ───────────────────────────────────────────────────────────────

SEPARATOR = "-" * 78
SECTION_SEP = "=" * 80
TASK_FILES = ["to-do.txt", "progressing.txt", "done.txt"]
IDEA_FILES = ["ideas.txt", "idea-disapproved.txt"]
ALL_FILES = TASK_FILES + IDEA_FILES

STATUS_MAP = {"[ ]": "todo", "[~]": "progressing", "[x]": "done", "[!]": "blocked"}
STATUS_REVERSE = {"todo": "[ ]", "progressing": "[~]", "done": "[x]", "blocked": "[!]"}
FILE_FOR_STATUS = {
    "todo": "to-do.txt",
    "progressing": "progressing.txt",
    "done": "done.txt",
}

# Known crypto/algorithm prefixes to exclude from task ID detection
CRYPTO_PREFIXES = {"AES", "SHA", "RSA", "MD5", "RC4", "DES", "DSA", "ECC", "CBC", "GCM", "CTR", "ECB"}

# ── Regexes ─────────────────────────────────────────────────────────────────

TASK_HEADER_RE = re.compile(r"^\[(.)\]\s+([A-Z][A-Z0-9]{1,5}-\d{3})\s+—\s+(.+)$")
IDEA_HEADER_RE = re.compile(r"^(IDEA-\d{3})\s+—\s+(.+)$")
TASK_CODE_RE = re.compile(r"[A-Z][A-Z0-9]{1,5}-(\d{3})")
IDEA_CODE_RE = re.compile(r"IDEA-(\d{3})")
SECTION_HEADER_RE = re.compile(r"^\s+SECTION\s+([A-Z])\s+—\s+(.+)$")


# ── Project Root Detection ──────────────────────────────────────────────────

def find_project_root() -> Path:
    """Find project root via git or by walking up to find to-do.txt."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        )
        root = Path(result.stdout.strip())
        if (root / "to-do.txt").exists():
            return root
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    d = Path.cwd()
    while d != d.parent:
        if (d / "to-do.txt").exists():
            return d
        d = d.parent

    # Last resort: current directory
    return Path.cwd()


# ── File Reading Helpers ────────────────────────────────────────────────────

def read_lines(filepath: Path) -> list[str]:
    """Read file lines, stripping \\r. Returns empty list if file missing."""
    if not filepath.exists():
        return []
    return filepath.read_text(encoding="utf-8").replace("\r", "").splitlines()


def write_lines(filepath: Path, lines: list[str]) -> None:
    """Write lines back to file with \\n endings."""
    filepath.write_text("\n".join(lines) + "\n" if lines else "", encoding="utf-8")


# ── Block Parsing ───────────────────────────────────────────────────────────

def is_separator(line: str) -> bool:
    """Check if line is a 78-dash task/idea separator."""
    return line.strip() == SEPARATOR


def is_section_sep(line: str) -> bool:
    """Check if line is an 80-equals section separator."""
    return line.strip() == SECTION_SEP


def parse_blocks(filepath: Path) -> list[dict]:
    """Parse all task/idea blocks from a file.

    Returns list of dicts with keys:
      line_start, line_end (0-indexed, inclusive of separators)
      code, title, status_symbol, status
      priority, dependencies, description, technical_details
      files_create, files_modify
      raw (the full block text including separators)
      block_type: "task" | "idea"
    """
    lines = read_lines(filepath)
    blocks = []
    i = 0

    while i < len(lines):
        if not is_separator(lines[i]):
            i += 1
            continue

        sep_start = i
        # Next line should be a header
        if i + 1 >= len(lines):
            i += 1
            continue

        header_line = lines[i + 1]

        # Try task header
        task_match = TASK_HEADER_RE.match(header_line)
        idea_match = IDEA_HEADER_RE.match(header_line) if not task_match else None

        if not task_match and not idea_match:
            i += 1
            continue

        # Expect closing separator on line i+2
        if i + 2 >= len(lines) or not is_separator(lines[i + 2]):
            i += 1
            continue

        # Find the end of the block content (next separator or section sep or EOF)
        content_start = i + 3
        content_end = content_start
        while content_end < len(lines):
            if is_separator(lines[content_end]) or is_section_sep(lines[content_end]):
                break
            content_end += 1

        # Trim trailing blank lines from content
        actual_end = content_end
        while actual_end > content_start and lines[actual_end - 1].strip() == "":
            actual_end -= 1

        # The block spans from sep_start to content_end (exclusive)
        block_lines = lines[sep_start:content_end]
        content_lines = lines[content_start:actual_end]

        block = {
            "line_start": sep_start,
            "line_end": content_end - 1,  # inclusive
            "raw": "\n".join(block_lines),
        }

        if task_match:
            status_char = task_match.group(1)
            symbol = f"[{status_char}]"
            block.update({
                "block_type": "task",
                "status_symbol": symbol,
                "status": STATUS_MAP.get(symbol, "unknown"),
                "code": task_match.group(2),
                "title": task_match.group(3).strip(),
            })
        else:
            block.update({
                "block_type": "idea",
                "status_symbol": "",
                "status": "idea",
                "code": idea_match.group(1),
                "title": idea_match.group(2).strip(),
            })

        # Parse content fields
        _parse_content_fields(block, content_lines)
        blocks.append(block)
        i = content_end

    return blocks


def _parse_content_fields(block: dict, content_lines: list[str]) -> None:
    """Parse the indented fields from a block's content lines."""
    block["priority"] = ""
    block["dependencies"] = ""
    block["description"] = ""
    block["technical_details"] = ""
    block["files_create"] = []
    block["files_modify"] = []
    block["category"] = ""
    block["date"] = ""
    block["motivation"] = ""
    block["completed"] = ""
    block["rejection_reason"] = ""

    current_section = None
    section_lines = []

    def flush_section():
        if current_section and section_lines:
            text = "\n".join(section_lines).strip()
            if current_section == "description":
                block["description"] = text
            elif current_section == "technical_details":
                block["technical_details"] = text
            elif current_section == "motivation":
                block["motivation"] = text
            elif current_section == "rejection_reason":
                block["rejection_reason"] = text
            elif current_section == "files_involved":
                _parse_files_involved(block, section_lines)

    for line in content_lines:
        stripped = line.strip()

        # Single-line fields
        if stripped.startswith("Priority:"):
            block["priority"] = stripped[len("Priority:"):].strip()
            continue
        if stripped.startswith("Dependencies:"):
            block["dependencies"] = stripped[len("Dependencies:"):].strip()
            continue
        if stripped.startswith("Category:"):
            block["category"] = stripped[len("Category:"):].strip()
            continue
        if stripped.startswith("Date:"):
            block["date"] = stripped[len("Date:"):].strip()
            continue
        if stripped.startswith("Last updated:"):
            continue
        if stripped.startswith("COMPLETED:"):
            block["completed"] = stripped[len("COMPLETED:"):].strip()
            continue

        # Multi-line section headers
        if stripped == "DESCRIPTION:":
            flush_section()
            current_section = "description"
            section_lines = []
            continue
        if stripped == "TECHNICAL DETAILS:":
            flush_section()
            current_section = "technical_details"
            section_lines = []
            continue
        if stripped == "MOTIVATION:":
            flush_section()
            current_section = "motivation"
            section_lines = []
            continue
        if stripped == "REJECTION REASON:":
            flush_section()
            current_section = "rejection_reason"
            section_lines = []
            continue
        if stripped.startswith("Files involved:"):
            flush_section()
            current_section = "files_involved"
            section_lines = []
            continue

        # Continuation of current section
        if current_section:
            section_lines.append(line)

    flush_section()


def _parse_files_involved(block: dict, lines: list[str]) -> None:
    """Parse CREATE: and MODIFY: entries from Files involved lines."""
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("CREATE:"):
            path = stripped[len("CREATE:"):].strip()
            if path:
                block["files_create"].append(path)
        elif stripped.startswith("MODIFY:"):
            path = stripped[len("MODIFY:"):].strip()
            if path:
                block["files_modify"].append(path)


def find_block(filepath: Path, code: str) -> dict | None:
    """Find a specific block by its code."""
    for block in parse_blocks(filepath):
        if block["code"] == code:
            return block
    return None


def find_block_in_all(root: Path, code: str, file_list: list[str] | None = None) -> tuple[dict | None, str | None]:
    """Find a block across multiple files. Returns (block, filename) or (None, None)."""
    files = file_list or ALL_FILES
    for fname in files:
        fp = root / fname
        if fp.exists():
            block = find_block(fp, code)
            if block:
                return block, fname
    return None, None


# ── Section Parsing ─────────────────────────────────────────────────────────

def parse_sections(filepath: Path) -> list[dict]:
    """Parse section headers from a file.

    Returns list of {letter, name, line_number (0-indexed)}.
    """
    lines = read_lines(filepath)
    sections = []

    for i, line in enumerate(lines):
        if is_section_sep(line) and i + 1 < len(lines):
            m = SECTION_HEADER_RE.match(lines[i + 1])
            if m:
                sections.append({
                    "letter": m.group(1),
                    "name": m.group(2).strip(),
                    "line_number": i,
                })

    return sections


def find_section_range(filepath: Path, section_letter: str) -> tuple[int, int] | None:
    """Find the line range for a section (start of content to next section or EOF).

    Returns (content_start, content_end) as 0-indexed line numbers.
    content_start is the first line after the section separator block.
    content_end is the line before the next section separator (or EOF).
    """
    lines = read_lines(filepath)
    sections = parse_sections(filepath)

    target = None
    next_section_line = len(lines)

    for idx, sec in enumerate(sections):
        if sec["letter"] == section_letter:
            target = sec
            # Content starts after the closing = separator (line_number + 2)
            if idx + 1 < len(sections):
                next_section_line = sections[idx + 1]["line_number"]
            break

    if target is None:
        return None

    content_start = target["line_number"] + 3  # skip =, title, =
    return (content_start, next_section_line)


# ── Subcommand: platform-config ────────────────────────────────────────────

def cmd_platform_config(args):
    """Return platform tracker configuration as JSON."""
    root = find_project_root()

    config_file = None
    data = {}
    for candidate in ["issues-tracker.json", "github-issues.json"]:
        fp = root / ".claude" / candidate
        if fp.exists():
            config_file = str(Path(".claude") / candidate)
            with open(fp, "r", encoding="utf-8") as f:
                data = json.load(f)
            break

    enabled = data.get("enabled", False)
    sync = data.get("sync", False)
    platform = data.get("platform", "github")

    if enabled and not sync:
        mode = "platform-only"
    elif enabled and sync:
        mode = "dual-sync"
    else:
        mode = "local-only"

    result = {
        "platform": platform,
        "enabled": enabled,
        "sync": sync,
        "repo": data.get("repo"),
        "mode": mode,
        "config_file": config_file,
        "cli": "glab" if platform == "gitlab" else "gh",
        "labels": data.get("labels"),
    }
    print(json.dumps(result, indent=2))


# ── Subcommand: next-id ─────────────────────────────────────────────────────

def _next_id_from_stdin(code_re, filter_crypto=True):
    """Parse task/idea codes from stdin lines, return (max_num, prefixes)."""
    max_num = 0
    prefixes = set()
    for line in sys.stdin:
        for m in code_re.finditer(line):
            full_match = m.group(0)
            num = int(m.group(1))
            prefix = full_match.rsplit("-", 1)[0]
            if filter_crypto and prefix in CRYPTO_PREFIXES:
                continue
            if num > max_num:
                max_num = num
            prefixes.add(prefix)
    return max_num, prefixes


def cmd_next_id(args):
    root = find_project_root()
    max_num = 0
    prefixes = set()

    if args.source == "platform-titles":
        code_re = TASK_CODE_RE if args.type == "task" else IDEA_CODE_RE
        max_num, prefixes = _next_id_from_stdin(code_re, filter_crypto=True)
    elif args.type == "task":
        files = [root / f for f in TASK_FILES]
        for fp in files:
            if not fp.exists():
                continue
            for block in parse_blocks(fp):
                if block["block_type"] != "task":
                    continue
                code = block["code"]
                prefix = code.rsplit("-", 1)[0]
                num = int(code.rsplit("-", 1)[1])
                if num > max_num:
                    max_num = num
                prefixes.add(prefix)
    else:
        files = [root / f for f in IDEA_FILES]
        for fp in files:
            if not fp.exists():
                continue
            for block in parse_blocks(fp):
                if block["block_type"] != "idea":
                    continue
                num = int(block["code"].split("-")[1])
                if num > max_num:
                    max_num = num

    result = {
        "next_number": f"{max_num + 1:03d}",
        "max_found": max_num,
    }
    if args.type == "task":
        result["prefixes"] = sorted(prefixes)

    print(json.dumps(result))


# ── Subcommand: list ─────────────────────────────────────────────────────────

def cmd_list(args):
    root = find_project_root()
    results = []

    if args.status == "all":
        files_to_scan = TASK_FILES
    elif args.status == "blocked":
        files_to_scan = ["to-do.txt"]
    else:
        files_to_scan = [FILE_FOR_STATUS.get(args.status, "to-do.txt")]

    for fname in files_to_scan:
        fp = root / fname
        if not fp.exists():
            continue
        for block in parse_blocks(fp):
            if block["block_type"] != "task":
                continue
            if args.status == "blocked" and block["status"] != "blocked":
                continue
            if args.status != "all" and args.status != "blocked" and block["status"] != args.status:
                continue
            results.append({
                "code": block["code"],
                "title": block["title"],
                "status": block["status"],
                "priority": block["priority"],
                "dependencies": block["dependencies"],
                "file": fname,
            })

    if args.format == "json":
        print(json.dumps(results, indent=2))
    else:
        if not results:
            print("(none)")
        else:
            for r in results:
                symbol = STATUS_REVERSE.get(r["status"], "[ ]")
                print(f"{symbol} {r['code']} — {r['title']}")


# ── Subcommand: list-ideas ───────────────────────────────────────────────────

def cmd_list_ideas(args):
    root = find_project_root()
    results = []

    file_map = {
        "ideas": ["ideas.txt"],
        "disapproved": ["idea-disapproved.txt"],
        "all": IDEA_FILES,
    }
    files_to_scan = file_map.get(args.file, IDEA_FILES)

    for fname in files_to_scan:
        fp = root / fname
        if not fp.exists():
            continue
        for block in parse_blocks(fp):
            if block["block_type"] != "idea":
                continue
            results.append({
                "code": block["code"],
                "title": block["title"],
                "category": block["category"],
                "date": block["date"],
                "file": fname,
            })

    if args.format == "json":
        print(json.dumps(results, indent=2))
    else:
        if not results:
            print("(none)")
        else:
            for r in results:
                print(f"{r['code']} — {r['title']}")


# ── Subcommand: parse ────────────────────────────────────────────────────────

def cmd_parse(args):
    root = find_project_root()
    code = args.code.upper()

    block, fname = find_block_in_all(root, code)
    if not block:
        print(json.dumps({"error": f"Block {code} not found in any file"}))
        sys.exit(1)

    block["source_file"] = fname
    # Remove internal line tracking from output
    output = {k: v for k, v in block.items() if k not in ("line_start", "line_end")}
    print(json.dumps(output, indent=2))


# ── Subcommand: summary ─────────────────────────────────────────────────────

def cmd_summary(args):
    root = find_project_root()
    counts = {"done": 0, "progressing": 0, "todo": 0, "blocked": 0}

    for fname, expected in [
        ("done.txt", ["done"]),
        ("progressing.txt", ["progressing"]),
        ("to-do.txt", ["todo", "blocked"]),
    ]:
        fp = root / fname
        if not fp.exists():
            continue
        for block in parse_blocks(fp):
            if block["block_type"] == "task" and block["status"] in expected:
                counts[block["status"]] += 1

    total = sum(counts.values())
    pct = (counts["done"] * 100 // total) if total > 0 else 0

    result = {**counts, "total": total, "percent": pct}

    if args.format == "text":
        print("=== TASK SUMMARY ===")
        print(f"  Completed:   {counts['done']}/{total}")
        print(f"  In progress: {counts['progressing']}")
        print(f"  Todo:        {counts['todo']}")
        print(f"  Blocked:     {counts['blocked']}")
        if total > 0:
            print(f"  Progress:    {pct}%")
        print("=====================")
    else:
        print(json.dumps(result))


# ── Subcommand: prefixes ────────────────────────────────────────────────────

def cmd_prefixes(args):
    root = find_project_root()
    prefixes = set()

    for fname in TASK_FILES:
        fp = root / fname
        if not fp.exists():
            continue
        for block in parse_blocks(fp):
            if block["block_type"] == "task":
                prefix = block["code"].rsplit("-", 1)[0]
                prefixes.add(prefix)

    print(json.dumps(sorted(prefixes)))


# ── Subcommand: sections ────────────────────────────────────────────────────

def cmd_sections(args):
    root = find_project_root()
    fp = root / args.file
    if not fp.exists():
        print(json.dumps({"error": f"File {args.file} not found"}))
        sys.exit(1)

    sections = parse_sections(fp)
    print(json.dumps(sections, indent=2))


# ── Subcommand: duplicates ──────────────────────────────────────────────────

def cmd_duplicates(args):
    root = find_project_root()
    keywords = [k.strip() for k in args.keywords.split(",") if k.strip()]
    files = [f.strip() for f in args.files.split(",")] if args.files else ALL_FILES

    matches = []
    for fname in files:
        fp = root / fname
        if not fp.exists():
            continue
        for i, line in enumerate(read_lines(fp), 1):
            line_lower = line.lower()
            for kw in keywords:
                if kw.lower() in line_lower:
                    matches.append({
                        "file": fname,
                        "line": i,
                        "keyword": kw,
                        "text": line.strip(),
                    })
                    break  # one match per line

    print(json.dumps(matches, indent=2))


# ── Subcommand: verify-files ────────────────────────────────────────────────

def cmd_verify_files(args):
    root = find_project_root()
    code = args.code.upper()

    block, fname = find_block_in_all(root, code, TASK_FILES)
    if not block:
        print(json.dumps({"error": f"Task {code} not found"}))
        sys.exit(1)

    report = {"code": code, "source_file": fname, "create": [], "modify": []}

    for f in block.get("files_create", []):
        exists = (root / f).exists()
        report["create"].append({"path": f, "exists": exists})

    for f in block.get("files_modify", []):
        exists = (root / f).exists()
        report["modify"].append({"path": f, "exists": exists})

    report["all_exist"] = (
        all(e["exists"] for e in report["create"])
        and all(e["exists"] for e in report["modify"])
    )

    print(json.dumps(report, indent=2))


# ── Subcommand: move ────────────────────────────────────────────────────────

def cmd_move(args):
    root = find_project_root()
    code = args.code.upper()
    target_status = args.to
    target_file = FILE_FOR_STATUS.get(target_status)

    if not target_file:
        print(json.dumps({"error": f"Invalid target status: {target_status}"}))
        sys.exit(1)

    # Find the block
    source_file = None
    block = None
    for fname in TASK_FILES:
        fp = root / fname
        if not fp.exists():
            continue
        b = find_block(fp, code)
        if b:
            source_file = fname
            block = b
            break

    if not block:
        print(json.dumps({"error": f"Task {code} not found in any task file"}))
        sys.exit(1)

    if source_file == target_file:
        print(json.dumps({"error": f"Task {code} is already in {target_file}"}))
        sys.exit(1)

    # Read source file and remove the block
    src_path = root / source_file
    src_lines = read_lines(src_path)
    start = block["line_start"]
    end = block["line_end"] + 1  # exclusive

    # Also remove trailing blank lines after the block
    while end < len(src_lines) and src_lines[end].strip() == "":
        end += 1
    # But keep at least one blank line if there's content after
    if end < len(src_lines) and src_lines[end].strip() != "":
        end -= 1

    removed_lines = src_lines[start:block["line_end"] + 1]  # just the block, no trailing blanks
    src_lines = src_lines[:start] + src_lines[end:]

    # Clean up triple+ blank lines in source
    cleaned = []
    blank_count = 0
    for line in src_lines:
        if line.strip() == "":
            blank_count += 1
            if blank_count <= 2:
                cleaned.append(line)
        else:
            blank_count = 0
            cleaned.append(line)
    src_lines = cleaned

    write_lines(src_path, src_lines)

    # Prepare the block for insertion
    block_text = "\n".join(removed_lines)

    # Update status symbol
    old_symbol = block["status_symbol"]
    new_symbol = STATUS_REVERSE[target_status]
    if old_symbol and old_symbol != new_symbol:
        block_text = block_text.replace(old_symbol, new_symbol, 1)

    # Add COMPLETED line if moving to done
    if target_status == "done" and args.completed_summary:
        # Insert after Dependencies line
        block_lines_list = block_text.split("\n")
        insert_idx = None
        for idx, line in enumerate(block_lines_list):
            if line.strip().startswith("Dependencies:"):
                insert_idx = idx + 1
                break
        if insert_idx is not None:
            block_lines_list.insert(insert_idx, f"  COMPLETED: {args.completed_summary}")
            block_text = "\n".join(block_lines_list)

    # Find insertion point in target file
    tgt_path = root / target_file
    tgt_lines = read_lines(tgt_path) if tgt_path.exists() else []

    # Find the best section to insert into
    # Try to match the section from the source file
    source_sections = parse_sections(src_path)
    target_sections = parse_sections(tgt_path)

    # Determine which section the block was in
    block_section = None
    for sec in parse_sections(root / source_file) if (root / source_file).exists() else source_sections:
        # This won't work after removal, use original block position
        pass

    # Simpler approach: find the last task block in the target file before the
    # RECOMMENDED IMPLEMENTATION ORDER or NOTES sections, and append there.
    # Or find the matching section letter.

    # Find the last content line before a section separator or EOF
    insert_pos = _find_insert_position(tgt_lines, target_sections)

    # Build insertion: two blank lines + block + blank line
    insertion = ["", ""] + block_text.split("\n") + [""]

    tgt_lines = tgt_lines[:insert_pos] + insertion + tgt_lines[insert_pos:]

    # Clean up triple+ blank lines
    cleaned = []
    blank_count = 0
    for line in tgt_lines:
        if line.strip() == "":
            blank_count += 1
            if blank_count <= 2:
                cleaned.append(line)
        else:
            blank_count = 0
            cleaned.append(line)

    write_lines(tgt_path, cleaned)

    print(json.dumps({
        "success": True,
        "code": code,
        "from_file": source_file,
        "to_file": target_file,
        "new_status": target_status,
    }))


def _find_insert_position(lines: list[str], sections: list[dict]) -> int:
    """Find the best position to insert a new block in a task file.

    Inserts before the RECOMMENDED IMPLEMENTATION ORDER section or NOTES section,
    or at the end of the last regular section's content.
    """
    # Look for RECOMMENDED or NOTES section and insert before it
    for i, line in enumerate(lines):
        if is_section_sep(line) and i + 1 < len(lines):
            next_line = lines[i + 1].strip()
            if "RECOMMENDED" in next_line or "NOTES" in next_line:
                # Go back to find the right spot (skip blank lines)
                pos = i
                while pos > 0 and lines[pos - 1].strip() == "":
                    pos -= 1
                return pos

    # If no special sections found, find the last section content area
    if sections:
        last_sec = sections[-1]
        # Find end of that section's content
        start = last_sec["line_number"] + 3
        pos = start
        for j in range(start, len(lines)):
            if is_section_sep(lines[j]):
                pos = j
                while pos > 0 and lines[pos - 1].strip() == "":
                    pos -= 1
                return pos
            pos = j + 1
        return pos

    # Fallback: end of file
    return len(lines)


# ── Subcommand: remove ──────────────────────────────────────────────────────

def cmd_remove(args):
    root = find_project_root()
    code = args.code.upper()
    fp = root / args.file

    if not fp.exists():
        print(json.dumps({"error": f"File {args.file} not found"}))
        sys.exit(1)

    block = find_block(fp, code)
    if not block:
        print(json.dumps({"error": f"Block {code} not found in {args.file}"}))
        sys.exit(1)

    lines = read_lines(fp)
    start = block["line_start"]
    end = block["line_end"] + 1

    # Also remove trailing blank lines
    while end < len(lines) and lines[end].strip() == "":
        end += 1
    # Keep at least one blank line
    if end < len(lines):
        end -= 1

    removed_text = "\n".join(lines[start:block["line_end"] + 1])
    lines = lines[:start] + lines[end:]

    # Clean up triple+ blank lines
    cleaned = []
    blank_count = 0
    for line in lines:
        if line.strip() == "":
            blank_count += 1
            if blank_count <= 2:
                cleaned.append(line)
        else:
            blank_count = 0
            cleaned.append(line)

    write_lines(fp, cleaned)

    print(json.dumps({
        "success": True,
        "code": code,
        "file": args.file,
        "removed_block": removed_text,
    }))


# ── Subcommand: hook ─────────────────────────────────────────────────────────

def cmd_hook(args):
    root = find_project_root()
    filepath = args.filepath
    filename = os.path.basename(filepath)

    # Check progressing tasks for file correlation
    prog_path = root / "progressing.txt"
    related = None
    if prog_path.exists():
        for block in parse_blocks(prog_path):
            if block["block_type"] != "task":
                continue
            all_files = block.get("files_create", []) + block.get("files_modify", [])
            for f in all_files:
                if os.path.basename(f) == filename or f == filepath:
                    related = block
                    break
            if related:
                break

    if related:
        print(f"\n--- Related Task ---")
        print(f"  File:   {filepath}")
        print(f"  Task:   [{related['code']}] {related['title']}")
        print(f"  Status: {related['status'].upper()}")
        print(f"--------------------")

    # Print summary
    counts = {"done": 0, "progressing": 0, "todo": 0, "blocked": 0}
    for fname, expected in [
        ("done.txt", ["done"]),
        ("progressing.txt", ["progressing"]),
        ("to-do.txt", ["todo", "blocked"]),
    ]:
        fp = root / fname
        if not fp.exists():
            continue
        for block in parse_blocks(fp):
            if block["block_type"] == "task" and block["status"] in expected:
                counts[block["status"]] += 1

    total = sum(counts.values())
    if total > 0:
        pct = counts["done"] * 100 // total
        print(f"\n=== TASK SUMMARY ===")
        print(f"  Completed:   {counts['done']}/{total}")
        print(f"  In progress: {counts['progressing']}")
        print(f"  Todo:        {counts['todo']}")
        print(f"  Blocked:     {counts['blocked']}")
        print(f"  Progress:    {pct}%")
        print(f"=====================")


# ── Subcommand: find-files ──────────────────────────────────────────────────

def cmd_find_files(args):
    """Cross-platform file search using pathlib glob."""
    root = find_project_root()
    patterns = [p.strip() for p in args.patterns.split(",") if p.strip()]
    results = []

    for pattern in patterns:
        for match in sorted(root.rglob(pattern)):
            if not match.is_file():
                continue
            try:
                rel = match.relative_to(root)
            except ValueError:
                continue
            # Respect max-depth
            if args.max_depth is not None and len(rel.parts) > args.max_depth:
                continue
            # Skip common ignored directories
            parts_str = str(rel)
            if any(skip in parts_str for skip in ["node_modules", ".git", "__pycache__", ".venv", "venv"]):
                continue
            results.append(str(rel))
            if len(results) >= args.limit:
                break
        if len(results) >= args.limit:
            break

    if args.format == "json":
        print(json.dumps(results[:args.limit]))
    else:
        if not results:
            print("(none found)")
        else:
            for r in results[:args.limit]:
                print(r)


# ── Subcommand: platform-cmd ───────────────────────────────────────────────

def _load_platform_config():
    """Load platform config (reuses platform-config logic)."""
    root = find_project_root()
    for candidate in ["issues-tracker.json", "github-issues.json"]:
        fp = root / ".claude" / candidate
        if fp.exists():
            with open(fp, "r", encoding="utf-8") as f:
                data = json.load(f)
            platform = data.get("platform", "github")
            return {
                "platform": platform,
                "repo": data.get("repo", ""),
                "cli": "glab" if platform == "gitlab" else "gh",
                "labels": data.get("labels", {}),
            }
    return {"platform": "github", "repo": "", "cli": "gh", "labels": {}}


def _shlex_quote(s: str) -> str:
    """Quote a string for shell use (cross-platform safe)."""
    if not s:
        return "''"
    # Simple quoting: if no special chars, return as-is
    import shlex
    return shlex.quote(s)


def cmd_platform_cmd(args):
    """Generate the correct platform CLI command string."""
    cfg = _load_platform_config()
    cli = cfg["cli"]
    repo = cfg["repo"]
    op = args.operation

    # Collect all extra key=value args into a dict
    params = {}
    if args.params:
        for p in args.params:
            if "=" in p:
                k, v = p.split("=", 1)
                params[k] = v

    cmd = None

    if cli == "gh":
        if op == "list-issues":
            cmd = f'gh issue list --repo "{repo}"'
            if params.get("labels"):
                cmd += f' --label "{params["labels"]}"'
            cmd += f' --state {params.get("state", "open")}'
            cmd += f' --json {params.get("json", "number,title")}'
            if params.get("jq"):
                cmd += f" --jq '{params['jq']}'"
        elif op == "search-issues":
            cmd = f'gh issue list --repo "{repo}"'
            cmd += f' --search "{params.get("search", "")}"'
            if params.get("labels"):
                cmd += f' --label "{params["labels"]}"'
            cmd += f' --state {params.get("state", "open")}'
            cmd += f' --json {params.get("json", "number,title")}'
        elif op == "view-issue":
            cmd = f'gh issue view {params.get("number", "N")} --repo "{repo}"'
            cmd += f' --json {params.get("json", "body")} --jq \'{params.get("jq", ".body")}\''
        elif op == "edit-issue":
            cmd = f'gh issue edit {params.get("number", "N")} --repo "{repo}"'
            if params.get("add-labels"):
                cmd += f' --add-label "{params["add-labels"]}"'
            if params.get("remove-labels"):
                cmd += f' --remove-label "{params["remove-labels"]}"'
        elif op == "close-issue":
            cmd = f'gh issue close {params.get("number", "N")} --repo "{repo}"'
            if params.get("comment"):
                cmd += f' --comment "{params["comment"]}"'
        elif op == "comment-issue":
            cmd = f'gh issue comment {params.get("number", "N")} --repo "{repo}"'
            cmd += f' --body "{params.get("body", "")}"'
        elif op == "create-issue":
            cmd = f'gh issue create --repo "{repo}"'
            cmd += f' --title "{params.get("title", "")}"'
            cmd += f' --body "{params.get("body", "")}"'
            if params.get("labels"):
                cmd += f' --label "{params["labels"]}"'
        elif op == "create-pr":
            cmd = f'gh pr create'
            cmd += f' --base {params.get("base", "main")}'
            cmd += f' --head {params.get("head", "")}'
            cmd += f' --title "{params.get("title", "")}"'
            cmd += f' --body "{params.get("body", "")}"'
        elif op == "list-pr":
            cmd = f'gh pr list'
            cmd += f' --base {params.get("base", "main")}'
            cmd += f' --head {params.get("head", "")}'
            cmd += f' --state {params.get("state", "open")}'
            cmd += f' --json {params.get("json", "number,url")}'
            if params.get("jq"):
                cmd += f" --jq '{params['jq']}'"
        elif op == "merge-pr":
            cmd = f'gh pr merge {params.get("url", "")} --auto --merge'
        elif op == "create-release":
            cmd = f'gh release create "{params.get("tag", "")}" --repo "{repo}"'
            cmd += f' --title "{params.get("title", "")}"'
            cmd += f' --notes "{params.get("notes", "")}"'
            if params.get("prerelease") == "true":
                cmd += " --prerelease"
        elif op == "edit-release":
            cmd = f'gh release edit "{params.get("tag", "")}" --repo "{repo}"'
            cmd += f' --notes "{params.get("notes", "")}"'
        else:
            print(json.dumps({"error": f"Unknown operation: {op}"}))
            sys.exit(1)

    elif cli == "glab":
        if op == "list-issues":
            cmd = f'glab issue list -R "{repo}"'
            if params.get("labels"):
                cmd += f' -l "{params["labels"]}"'
            state = params.get("state", "open")
            cmd += f' --state {"opened" if state == "open" else state}'
            cmd += f' --output json'
            if params.get("jq"):
                cmd += f" | jq '{params['jq']}'"
        elif op == "search-issues":
            cmd = f'glab issue list -R "{repo}"'
            cmd += f' --search "{params.get("search", "")}"'
            if params.get("labels"):
                cmd += f' -l "{params["labels"]}"'
            cmd += ' --output json'
        elif op == "view-issue":
            cmd = f'glab issue view {params.get("number", "N")} -R "{repo}"'
            cmd += f' --output json | jq \'{params.get("jq", ".description")}\''
        elif op == "edit-issue":
            cmd = f'glab issue update {params.get("number", "N")} -R "{repo}"'
            if params.get("add-labels"):
                cmd += f' --label "{params["add-labels"]}"'
            if params.get("remove-labels"):
                cmd += f' --unlabel "{params["remove-labels"]}"'
        elif op == "close-issue":
            cmd = f'glab issue close {params.get("number", "N")} -R "{repo}"'
            if params.get("comment"):
                cmd += f'\nglab issue note {params.get("number", "N")} -R "{repo}" -m "{params["comment"]}"'
        elif op == "comment-issue":
            cmd = f'glab issue note {params.get("number", "N")} -R "{repo}"'
            cmd += f' -m "{params.get("body", "")}"'
        elif op == "create-issue":
            cmd = f'glab issue create -R "{repo}"'
            cmd += f' --title "{params.get("title", "")}"'
            cmd += f' --description "{params.get("body", "")}"'
            if params.get("labels"):
                cmd += f' -l "{params["labels"]}"'
        elif op == "create-pr":
            cmd = f'glab mr create'
            cmd += f' --target-branch {params.get("base", "main")}'
            cmd += f' --source-branch {params.get("head", "")}'
            cmd += f' --title "{params.get("title", "")}"'
            cmd += f' --description "{params.get("body", "")}"'
        elif op == "list-pr":
            cmd = f'glab mr list'
            cmd += f' --target-branch {params.get("base", "main")}'
            cmd += f' --source-branch {params.get("head", "")}'
            state = params.get("state", "open")
            cmd += f' --state {"opened" if state == "open" else state}'
            cmd += ' --output json'
            if params.get("jq"):
                cmd += f" | jq '{params['jq']}'"
        elif op == "merge-pr":
            cmd = f'glab mr merge {params.get("number", "")} --auto-merge --when-pipeline-succeeds'
        elif op == "create-release":
            cmd = f'glab release create "{params.get("tag", "")}" --name "{params.get("title", "")}"'
            cmd += f' --notes "{params.get("notes", "")}"'
        elif op == "edit-release":
            cmd = f'glab release update "{params.get("tag", "")}"'
            cmd += f' --notes "{params.get("notes", "")}"'
        else:
            print(json.dumps({"error": f"Unknown operation: {op}"}))
            sys.exit(1)

    print(cmd)


# ── Subcommand: pr-body ───────────────────────────────────────────────────

PR_BODY_TEMPLATES = {
    "task-pick": """## Task {task_code} — {title}

### Summary
{summary}

{issue_ref}
---
*Generated by Claude Code via `/task-pick`*""",

    "test-engineer": """## Task {task_code} — {title}

### Summary
Task tested and verified by test-engineer.

### Test Results
{summary}

{issue_ref}
---
*Generated by Claude Code via `/test-engineer`*""",

    "git-publish": """## Changes
{summary}

{issue_ref}
---
*Generated by Claude Code via `/git-publish`*""",

    "release": """## Changes
{summary}

{issue_ref}
---
*Generated by Claude Code via `/release`*""",
}


def cmd_pr_body(args):
    """Generate a PR body from template."""
    source = args.source
    template = PR_BODY_TEMPLATES.get(source, PR_BODY_TEMPLATES["task-pick"])

    issue_ref = ""
    if args.issue_num:
        issue_ref = f"### Related Issue\nRefs #{args.issue_num}"
        if args.task_code:
            issue_ref += f" ({args.task_code})"
        issue_ref += "\n"

    body = template.format(
        task_code=args.task_code or "",
        title=args.title or "",
        summary=args.summary or "",
        issue_ref=issue_ref,
    )

    # Clean up empty sections
    body = re.sub(r'\n\n\n+', '\n\n', body)
    print(body.strip())


# ── CLI Setup ────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Task and idea manager CLI for claude-task-development-framework",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # platform-config
    p = sub.add_parser("platform-config", help="Return platform tracker configuration")
    p.set_defaults(func=cmd_platform_config)

    # next-id
    p = sub.add_parser("next-id", help="Compute next sequential ID")
    p.add_argument("--type", choices=["task", "idea"], default="task")
    p.add_argument("--source", choices=["local", "platform-titles"], default="local",
                    help="Data source: local files (default) or platform titles from stdin")
    p.set_defaults(func=cmd_next_id)

    # list
    p = sub.add_parser("list", help="List tasks by status")
    p.add_argument("--status", choices=["todo", "progressing", "done", "blocked", "all"], default="all")
    p.add_argument("--format", choices=["json", "summary"], default="json")
    p.set_defaults(func=cmd_list)

    # list-ideas
    p = sub.add_parser("list-ideas", help="List ideas")
    p.add_argument("--file", choices=["ideas", "disapproved", "all"], default="all")
    p.add_argument("--format", choices=["json", "summary"], default="json")
    p.set_defaults(func=cmd_list_ideas)

    # parse
    p = sub.add_parser("parse", help="Parse a task/idea block to JSON")
    p.add_argument("code", help="Task or idea code (e.g., AUTH-001, IDEA-003)")
    p.set_defaults(func=cmd_parse)

    # summary
    p = sub.add_parser("summary", help="Task counts and progress")
    p.add_argument("--format", choices=["json", "text"], default="json")
    p.set_defaults(func=cmd_summary)

    # prefixes
    p = sub.add_parser("prefixes", help="List all task code prefixes")
    p.set_defaults(func=cmd_prefixes)

    # sections
    p = sub.add_parser("sections", help="List section headers from a file")
    p.add_argument("--file", required=True, help="File to scan (e.g., to-do.txt)")
    p.set_defaults(func=cmd_sections)

    # duplicates
    p = sub.add_parser("duplicates", help="Search for duplicate keywords")
    p.add_argument("--keywords", required=True, help="Comma-separated keywords")
    p.add_argument("--files", default=None, help="Comma-separated file list (default: all)")
    p.set_defaults(func=cmd_duplicates)

    # verify-files
    p = sub.add_parser("verify-files", help="Check file existence for a task")
    p.add_argument("code", help="Task code (e.g., AUTH-001)")
    p.set_defaults(func=cmd_verify_files)

    # move
    p = sub.add_parser("move", help="Move a task between files")
    p.add_argument("code", help="Task code (e.g., AUTH-001)")
    p.add_argument("--to", required=True, choices=["todo", "progressing", "done"])
    p.add_argument("--completed-summary", default=None, help="Summary for COMPLETED field (when moving to done)")
    p.set_defaults(func=cmd_move)

    # remove
    p = sub.add_parser("remove", help="Remove a block from a file")
    p.add_argument("code", help="Task or idea code")
    p.add_argument("--file", required=True, help="File to remove from")
    p.set_defaults(func=cmd_remove)

    # hook
    p = sub.add_parser("hook", help="PostToolUse hook mode")
    p.add_argument("filepath", nargs="?", default="", help="Modified file path")
    p.set_defaults(func=cmd_hook)

    # find-files
    p = sub.add_parser("find-files", help="Cross-platform file search")
    p.add_argument("--patterns", required=True, help="Comma-separated glob patterns")
    p.add_argument("--max-depth", type=int, default=None, help="Max directory depth")
    p.add_argument("--limit", type=int, default=50, help="Max results")
    p.add_argument("--format", choices=["json", "text"], default="text")
    p.set_defaults(func=cmd_find_files)

    # platform-cmd
    p = sub.add_parser("platform-cmd", help="Generate platform-specific CLI command")
    p.add_argument("operation", help="Operation name (e.g., create-issue, list-issues)")
    p.add_argument("params", nargs="*", help="Key=value parameters (e.g., title=T labels=L)")
    p.set_defaults(func=cmd_platform_cmd)

    # pr-body
    p = sub.add_parser("pr-body", help="Generate PR body from template")
    p.add_argument("--task-code", default=None, help="Task code (e.g., AUTH-001)")
    p.add_argument("--title", default=None, help="Task or PR title")
    p.add_argument("--summary", default=None, help="Summary of changes")
    p.add_argument("--issue-num", default=None, help="Related issue number")
    p.add_argument("--source", choices=["task-pick", "test-engineer", "git-publish", "release"],
                    default="task-pick", help="Source skill for template selection")
    p.set_defaults(func=cmd_pr_body)

    return parser


def main():
    parser = build_parser()
    is_hook = len(sys.argv) > 1 and sys.argv[1] == "hook"
    try:
        args = parser.parse_args()
        args.func(args)
    except SystemExit as e:
        if is_hook:
            sys.exit(0)
        raise
    except Exception as e:
        if is_hook:
            sys.exit(0)
        print(json.dumps({"error": str(e), "type": type(e).__name__}))
        sys.exit(1)


if __name__ == "__main__":
    main()
