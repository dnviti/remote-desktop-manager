#!/usr/bin/env python3
"""Create all required labels for the task/idea workflow.

Supports both GitHub (gh) and GitLab (glab) based on the "platform" field
in the issues tracker config.

Usage:
    python3 .claude/scripts/setup_labels.py

Prerequisites:
    - gh CLI (GitHub) or glab CLI (GitLab) installed and authenticated
    - Config file exists with "repo" configured

Zero external dependencies — stdlib only.
"""

import json
import subprocess
import sys
from pathlib import Path

# ── Color mappings ────────────────────────────────────────────────────────

PRIORITY_COLORS = {
    "HIGH": "d73a4a",
    "MEDIUM": "fbca04",
    "LOW": "0e8a16",
}

STATUS_COLORS = {
    "todo": "cfd3d7",
    "in-progress": "fbca04",
    "to-test": "d4c5f9",
    "done": "0e8a16",
}

SOURCE_COLOR = "0052cc"
TASK_COLOR = "1d76db"
IDEA_COLOR = "5319e7"
SECTION_COLOR = "c5def5"
DEFAULT_COLOR = "ededed"


# ── Helpers ───────────────────────────────────────────────────────────────

def find_project_root() -> Path:
    """Find project root via git."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        )
        return Path(result.stdout.strip())
    except (subprocess.CalledProcessError, FileNotFoundError):
        return Path.cwd()


def load_config(root: Path) -> tuple[dict, str]:
    """Load issues tracker config. Returns (data, config_path)."""
    for candidate in ["issues-tracker.json", "github-issues.json"]:
        fp = root / ".claude" / candidate
        if fp.exists():
            with open(fp, "r", encoding="utf-8") as f:
                return json.load(f), str(fp)
    return {}, ""


def create_label(platform: str, repo: str, name: str, color: str, description: str = "") -> None:
    """Create a single label via gh/glab CLI. Idempotent."""
    if platform == "gitlab":
        cmd = ["glab", "label", "create", name, "-R", repo,
               "--color", f"#{color}", "--description", description]
    else:
        cmd = ["gh", "label", "create", name, "--repo", repo,
               "--color", color, "--description", description]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        print(f"  Created: {name}")
    else:
        print(f"  Exists:  {name}")


# ── Main ──────────────────────────────────────────────────────────────────

def main() -> None:
    root = find_project_root()
    data, config_path = load_config(root)

    if not config_path:
        print("ERROR: No config file found. Copy .claude/issues-tracker.example.json "
              "to .claude/issues-tracker.json and configure it.")
        sys.exit(1)

    repo = data.get("repo", "")
    if not repo or repo == "null" or repo == "owner/repo":
        print(f"ERROR: 'repo' is not configured in {config_path}. "
              "Set it to your repository (e.g., 'user/project').")
        sys.exit(1)

    platform = data.get("platform", "github")
    labels = data.get("labels", {})

    print(f"Platform: {platform}")
    print(f"Setting up labels for repository: {repo}")
    print("---")

    # Source label
    source = labels.get("source", "claude-code")
    create_label(platform, repo, source, SOURCE_COLOR, "Created by Claude Code")

    # Type labels
    task_label = labels.get("task", "task")
    idea_label = labels.get("idea", "idea")
    create_label(platform, repo, task_label, TASK_COLOR, "Task work item")
    create_label(platform, repo, idea_label, IDEA_COLOR, "Idea proposal")

    # Priority labels
    priority_map = labels.get("priority", {})
    if priority_map:
        print("\nPriority labels:")
        for key, label_name in priority_map.items():
            color = PRIORITY_COLORS.get(key, DEFAULT_COLOR)
            create_label(platform, repo, label_name, color, f"Priority: {key}")

    # Status labels
    status_map = labels.get("status", {})
    if status_map:
        print("\nStatus labels:")
        for key, label_name in status_map.items():
            color = STATUS_COLORS.get(key, DEFAULT_COLOR)
            create_label(platform, repo, label_name, color, f"Status: {key}")

    # Section labels
    sections_map = labels.get("sections", {})
    if sections_map:
        print("\nSection labels:")
        for key, label_name in sections_map.items():
            create_label(platform, repo, label_name, SECTION_COLOR, f"Section: {key}")

    print(f"\nDone! All labels are set up for {repo}.")


if __name__ == "__main__":
    main()
