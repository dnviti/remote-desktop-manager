#!/usr/bin/env python3
"""Summarize installer failures for rescue paths."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


GENERIC_MESSAGES = {
    "failed",
    "failure",
    "non-zero return code",
    "one or more items failed",
    "task failed",
}


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace").strip()
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (list, tuple)):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value).strip()


def _task_label(task: Any) -> str:
    if isinstance(task, str):
        return task.strip()
    if isinstance(task, dict):
        for key in ("name", "action", "task"):
            label = _stringify(task.get(key))
            if label:
                return label
    return ""


def _item_label(node: dict[str, Any]) -> str:
    for key in ("item", "name", "service", "target"):
        label = _stringify(node.get(key))
        if label:
            return label
    return ""


def _stream_text(node: dict[str, Any], text_key: str, lines_key: str) -> str:
    text = _stringify(node.get(text_key))
    if text:
        return text
    lines = node.get(lines_key)
    if isinstance(lines, list):
        rendered = [_stringify(line) for line in lines if _stringify(line)]
        return "\n".join(rendered)
    return ""


def _is_generic_message(message: str) -> bool:
    normalized = message.strip().lower().rstrip(".")
    return normalized in GENERIC_MESSAGES or normalized.startswith("non-zero return code")


def _is_failure_node(node: dict[str, Any]) -> bool:
    if node.get("failed") is True or node.get("unreachable") is True:
        return True
    if node.get("exception"):
        return True
    rc = node.get("rc")
    if isinstance(rc, int) and rc != 0:
        return True
    if isinstance(rc, str) and rc.strip().isdigit() and int(rc.strip()) != 0:
        return True
    return False


def _find_failure_node(node: Any, item_path: tuple[str, ...] = ()) -> dict[str, Any] | None:
    if not isinstance(node, dict):
        return None

    path = item_path
    label = _item_label(node)
    if label:
        path = item_path + (label,)

    nested_result = node.get("result")
    if isinstance(nested_result, dict):
        candidate = _find_failure_node(nested_result, path)
        if candidate is not None:
            return candidate

    nested_results = node.get("results")
    if isinstance(nested_results, list):
        for child in nested_results:
            candidate = _find_failure_node(child, path)
            if candidate is not None:
                return candidate

    if _is_failure_node(node):
        return {"node": node, "item_path": path}
    return None


def _failure_summary_lines(payload: Any) -> tuple[list[str], dict[str, Any] | None, tuple[str, ...]]:
    if not isinstance(payload, dict):
        return [], None, ()

    task_name = _task_label(payload.get("task") or payload.get("ansible_failed_task"))
    root = payload.get("result") if isinstance(payload.get("result"), dict) else payload
    failure = _find_failure_node(root)
    if failure is None:
        return [], None, ()

    node = failure["node"]
    item_path = failure["item_path"]
    lines = ["installer apply failed"]
    if task_name:
        lines.append(f"task: {task_name}")
    if item_path:
        lines.append(f"item: {' > '.join(item_path)}")
    rc = node.get("rc")
    if rc not in (None, ""):
        lines.append(f"rc: {rc}")
    return lines, node, item_path


def build_safe_failure_message(payload: Any) -> str:
    lines, _, _ = _failure_summary_lines(payload)
    if len(lines) == 1:
        return ""
    return "\n".join(lines)


def build_detailed_failure_message(payload: Any) -> str:
    lines, node, _ = _failure_summary_lines(payload)
    if node is None:
        return ""

    message = _stringify(node.get("msg"))
    if message and not _is_generic_message(message):
        lines.append(f"message: {message}")

    stderr = _stream_text(node, "stderr", "stderr_lines")
    if stderr:
        lines.append(f"stderr: {stderr}")

    stdout = _stream_text(node, "stdout", "stdout_lines")
    if stdout:
        lines.append(f"stdout: {stdout}")

    if len(lines) == 1:
        return ""
    return "\n".join(lines)


def build_failure_message(payload: Any) -> str:
    return build_safe_failure_message(payload)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Summarize an installer failure payload.")
    parser.add_argument("--input")
    parser.add_argument("--stdin", action="store_true")
    parser.add_argument("--detail", action="store_true")
    return parser


def _load_payload(args: argparse.Namespace) -> Any:
    try:
        if args.input:
            return json.loads(Path(args.input).read_text(encoding="utf-8"))
        if args.stdin or not args.input:
            raw = sys.stdin.read()
            if raw.strip():
                return json.loads(raw)
    except Exception:
        return {}
    return {}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    payload = _load_payload(args)
    message = build_detailed_failure_message(payload) if args.detail else build_safe_failure_message(payload)
    print(message)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
