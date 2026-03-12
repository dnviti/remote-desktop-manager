#!/usr/bin/env python3
"""Application lifecycle manager for dev environments.

Provides port checking and process management for Claude Code skills:
- check-ports: Check which ports are in use
- kill-ports: Kill processes on specified ports
- verify-ports: Verify ports match expected state (bound/free)
- sleep: Cross-platform sleep

Supports Windows, macOS, and Linux with automatic OS detection.
All output is JSON. Zero external dependencies — stdlib only.
"""

import argparse
import json
import os
import platform
import signal
import subprocess
import sys
import time

IS_WINDOWS = platform.system() == "Windows"


# ── Port detection ─────────────────────────────────────────────────────────

def _get_port_info() -> dict[int, dict]:
    """Get listening port information.

    Returns {port: {"pid": int, "process": str}} for all listening TCP ports.
    Dispatches to platform-specific implementation automatically.
    """
    if IS_WINDOWS:
        return _get_port_info_windows()
    return _get_port_info_unix()


def _get_port_info_unix() -> dict[int, dict]:
    """Get port info on macOS/Linux using lsof or ss."""
    info: dict[int, dict] = {}

    # Try lsof first (macOS and most Linux)
    try:
        result = subprocess.run(
            ["lsof", "-iTCP", "-sTCP:LISTEN", "-P", "-n"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines()[1:]:  # skip header
                parts = line.split()
                if len(parts) < 9:
                    continue
                process_name = parts[0]
                try:
                    pid = int(parts[1])
                except (ValueError, IndexError):
                    continue
                # Parse port from the address field (e.g., "*:3000" or "127.0.0.1:8080")
                addr = parts[8]
                if ":" in addr:
                    port_str = addr.rsplit(":", 1)[1]
                    try:
                        port = int(port_str)
                        info[port] = {"pid": pid, "process": process_name}
                    except ValueError:
                        pass
            return info
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Fallback to ss (Linux)
    try:
        result = subprocess.run(
            ["ss", "-tlnp"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines()[1:]:
                parts = line.split()
                if len(parts) < 5:
                    continue
                # Local address is typically in column 3 (e.g., "0.0.0.0:3000")
                local_addr = parts[3]
                if ":" in local_addr:
                    port_str = local_addr.rsplit(":", 1)[1]
                    try:
                        port = int(port_str)
                    except ValueError:
                        continue
                    # Try to extract PID from the last column
                    pid = None
                    process_name = None
                    for p in parts:
                        if "pid=" in p:
                            try:
                                pid = int(p.split("pid=")[1].split(",")[0].split(")")[0])
                            except (ValueError, IndexError):
                                pass
                        if '((' in p or '("' in p:
                            process_name = p.strip('()"').split(',')[0].strip('"')
                    info[port] = {"pid": pid, "process": process_name}
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    return info


def _get_port_info_windows() -> dict[int, dict]:
    """Get port info on Windows using netstat -ano."""
    info: dict[int, dict] = {}

    try:
        result = subprocess.run(
            ["netstat", "-ano", "-p", "TCP"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return info

        # Collect PIDs to resolve process names in bulk
        pids_to_resolve: set[int] = set()

        for line in result.stdout.splitlines():
            line = line.strip()
            if "LISTENING" not in line:
                continue
            parts = line.split()
            # Expected: TCP  0.0.0.0:3000  0.0.0.0:0  LISTENING  12345
            if len(parts) < 5:
                continue
            local_addr = parts[1]
            if ":" not in local_addr:
                continue
            port_str = local_addr.rsplit(":", 1)[1]
            try:
                port = int(port_str)
                pid = int(parts[-1])
            except ValueError:
                continue
            info[port] = {"pid": pid, "process": None}
            pids_to_resolve.add(pid)

        # Resolve process names via tasklist
        if pids_to_resolve:
            pid_names = _resolve_process_names_windows(pids_to_resolve)
            for port_data in info.values():
                pid = port_data["pid"]
                if pid in pid_names:
                    port_data["process"] = pid_names[pid]

    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    return info


def _resolve_process_names_windows(pids: set[int]) -> dict[int, str]:
    """Resolve PIDs to process names on Windows using tasklist."""
    names: dict[int, str] = {}
    for pid in pids:
        try:
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                # Output: "process_name.exe","12345","Console","1","12,345 K"
                for line in result.stdout.splitlines():
                    line = line.strip()
                    if line.startswith('"'):
                        name = line.split('"')[1]
                        names[pid] = name
                        break
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass
    return names


# ── Process killing ────────────────────────────────────────────────────────

def _kill_process(pid: int) -> dict:
    """Kill a process by PID. Cross-platform."""
    if IS_WINDOWS:
        try:
            subprocess.run(
                ["taskkill", "/F", "/PID", str(pid)],
                capture_output=True, text=True, timeout=10,
            )
            return {"killed": True, "pid": pid, "signal": "taskkill"}
        except Exception as e:
            return {"killed": False, "pid": pid, "error": str(e)}
    else:
        try:
            os.kill(pid, signal.SIGTERM)
            return {"killed": True, "pid": pid, "signal": "SIGTERM"}
        except OSError:
            try:
                os.kill(pid, signal.SIGKILL)
                return {"killed": True, "pid": pid, "signal": "SIGKILL"}
            except OSError as e:
                return {"killed": False, "pid": pid, "error": str(e)}


# ── Commands ───────────────────────────────────────────────────────────────

def cmd_check_ports(args):
    """Check which specified ports are in use."""
    all_info = _get_port_info()
    result = {}

    for port in args.ports:
        if port in all_info:
            result[str(port)] = {
                "in_use": True,
                "pid": all_info[port]["pid"],
                "process": all_info[port]["process"],
            }
        else:
            result[str(port)] = {
                "in_use": False,
                "pid": None,
                "process": None,
            }

    print(json.dumps(result, indent=2))


def cmd_kill_ports(args):
    """Kill processes listening on specified ports."""
    all_info = _get_port_info()
    result = {}

    for port in args.ports:
        port_str = str(port)
        if port not in all_info or all_info[port]["pid"] is None:
            result[port_str] = {"killed": False, "pid": None, "reason": "not in use"}
            continue

        pid = all_info[port]["pid"]
        result[port_str] = _kill_process(pid)

    print(json.dumps(result, indent=2))


def cmd_verify_ports(args):
    """Verify that ports match expected state (bound or free)."""
    # Small delay to allow processes to start/stop
    if hasattr(args, 'wait') and args.wait:
        time.sleep(args.wait)

    all_info = _get_port_info()
    expect_bound = args.expect == "bound"
    all_match = True
    details = {}

    for port in args.ports:
        in_use = port in all_info
        actual = "bound" if in_use else "free"
        match = (in_use == expect_bound)
        if not match:
            all_match = False
        details[str(port)] = {
            "expected": args.expect,
            "actual": actual,
            "match": match,
        }
        if in_use and all_info[port]["pid"]:
            details[str(port)]["pid"] = all_info[port]["pid"]
            details[str(port)]["process"] = all_info[port]["process"]

    print(json.dumps({"all_match": all_match, "details": details}, indent=2))


def cmd_sleep(args):
    """Cross-platform sleep."""
    time.sleep(args.seconds)
    print(json.dumps({"slept": args.seconds}))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Application lifecycle manager for dev environments",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # check-ports
    p = sub.add_parser("check-ports", help="Check which ports are in use")
    p.add_argument("ports", nargs="+", type=int, help="Port numbers to check")
    p.set_defaults(func=cmd_check_ports)

    # kill-ports
    p = sub.add_parser("kill-ports", help="Kill processes on specified ports")
    p.add_argument("ports", nargs="+", type=int, help="Port numbers to kill")
    p.set_defaults(func=cmd_kill_ports)

    # verify-ports
    p = sub.add_parser("verify-ports", help="Verify ports match expected state")
    p.add_argument("--expect", required=True, choices=["bound", "free"],
                    help="Expected port state")
    p.add_argument("--wait", type=float, default=0,
                    help="Seconds to wait before checking (for startup/shutdown)")
    p.add_argument("ports", nargs="+", type=int, help="Port numbers to verify")
    p.set_defaults(func=cmd_verify_ports)

    # sleep
    p = sub.add_parser("sleep", help="Cross-platform sleep")
    p.add_argument("seconds", type=float, help="Seconds to sleep")
    p.set_defaults(func=cmd_sleep)

    return parser


def main():
    parser = build_parser()
    try:
        args = parser.parse_args()
        args.func(args)
    except SystemExit:
        raise
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__}))
        sys.exit(1)


if __name__ == "__main__":
    main()
