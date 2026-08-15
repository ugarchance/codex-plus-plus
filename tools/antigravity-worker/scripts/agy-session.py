#!/usr/bin/env python3
"""
Antigravity Session Manager for Codex & Peer Agents
Allows external agents (Codex, Claude, etc.) to use Antigravity as a stateful worker,
maintaining continuous chat context across multiple turns.
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

REGISTRY_DIR = Path.home() / ".agents" / "sessions"
REGISTRY_FILE = REGISTRY_DIR / "antigravity-sessions.json"

DEFAULT_PRINT_TIMEOUT = "45m"


def parse_duration(text: str) -> int:
    units = {"s": 1, "m": 60, "h": 3600}
    value = text.strip().lower()
    if value and value[-1] in units:
        return int(float(value[:-1]) * units[value[-1]])
    return int(float(value))


def load_registry() -> dict:
    if not REGISTRY_FILE.exists():
        return {}
    try:
        with open(REGISTRY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_registry(data: dict):
    REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    with open(REGISTRY_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def cmd_send(args):
    registry = load_registry()
    name = args.name
    session = registry.get(name, {})
    conv_id = session.get("conversation_id")

    cmd = ["agy"]

    if conv_id and not args.new:
        cmd.extend(["--conversation", conv_id])

    cmd.extend(["-p", args.prompt])
    cmd.append("--dangerously-skip-permissions")
    cmd.extend(["--output-format", "json"])
    cmd.extend(["--mode", args.mode])
    cmd.extend(["--print-timeout", args.print_timeout])

    workspace_dirs = list(args.add_dir or [])
    if args.cwd and args.cwd not in workspace_dirs:
        workspace_dirs.insert(0, args.cwd)
    for directory in workspace_dirs:
        cmd.extend(["--add-dir", os.path.abspath(directory)])

    if args.model:
        cmd.extend(["--model", args.model])
    if args.effort:
        cmd.extend(["--effort", args.effort])

    cwd = args.cwd if args.cwd else os.getcwd()

    def fail(message, extra=None):
        payload = {"status": "ERROR", "error": message}
        if extra:
            payload.update(extra)
        if args.json:
            print(json.dumps(payload, indent=2, ensure_ascii=False))
        else:
            print(message, file=sys.stderr)
        sys.exit(1)

    try:
        proc = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False,
            timeout=parse_duration(args.print_timeout) + 120,
        )
    except FileNotFoundError:
        fail("'agy' CLI bulunamadi. ~/.local/bin PATH'te mi?")
    except subprocess.TimeoutExpired:
        fail(
            f"Worker {args.print_timeout} icinde bitmedi. Gorevi bol ya da "
            f"--print-timeout degerini yukselt. Konusma '{name}' adiyla korunuyor.",
            {"conversation_id": conv_id},
        )

    stdout = proc.stdout.strip()
    stderr = proc.stderr.strip()

    if proc.returncode != 0 and not stdout:
        fail(f"agy {proc.returncode} koduyla cikti: {stderr}", {"stderr": stderr})

    # Parse JSON output from agy
    try:
        result = json.loads(stdout)
    except json.JSONDecodeError:
        result = {
            "status": "SUCCESS" if proc.returncode == 0 else "ERROR",
            "response": stdout,
            "conversation_id": conv_id or "unknown"
        }

    res_conv_id = result.get("conversation_id", conv_id)
    if res_conv_id:
        prev_turns = session.get("turns", 0)
        registry[name] = {
            "conversation_id": res_conv_id,
            "last_active": datetime.now().isoformat(),
            "cwd": cwd,
            "turns": prev_turns + 1,
            "model": args.model or session.get("model", "default"),
            "last_status": result.get("status", "UNKNOWN"),
            "total_tokens": session.get("total_tokens", 0)
            + result.get("usage", {}).get("total_tokens", 0),
        }
        save_registry(registry)

    if args.json:
        result["session_name"] = name
        result["is_continued"] = bool(conv_id and not args.new)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        response_text = result.get("response", stdout)
        print(response_text)


def cmd_list(args):
    registry = load_registry()
    if args.json:
        print(json.dumps(registry, indent=2, ensure_ascii=False))
        return

    if not registry:
        print("No active Antigravity worker sessions found.")
        return

    width = max([len(n) for n in registry] + [4]) + 2
    print(f"{'NAME':<{width}} {'TURNS':<7} {'LAST ACTIVE':<21} {'STATUS':<9} {'CWD'}")
    print("-" * (width + 80))
    for name, data in sorted(registry.items()):
        turns = str(data.get("turns", 0))
        last_active = data.get("last_active", "-")[:19]
        status = data.get("last_status", "-")
        cwd = data.get("cwd", "-")
        print(f"{name:<{width}} {turns:<7} {last_active:<21} {status:<9} {cwd}")


def cmd_show(args):
    registry = load_registry()
    name = args.name
    if name not in registry:
        print(f"Session '{name}' not found.", file=sys.stderr)
        sys.exit(1)

    session = registry[name]
    if args.json:
        print(json.dumps(session, indent=2, ensure_ascii=False))
    else:
        print(f"Session Name:    {name}")
        print(f"Conversation ID: {session.get('conversation_id')}")
        print(f"Turn Count:      {session.get('turns', 0)}")
        print(f"Last Active:     {session.get('last_active')}")
        print(f"Working Dir:     {session.get('cwd')}")


def cmd_reset(args):
    registry = load_registry()
    name = args.name
    if name in registry:
        del registry[name]
        save_registry(registry)
        print(f"Session '{name}' has been reset (context cleared).")
    else:
        print(f"Session '{name}' was not found in registry.")


def main():
    parser = argparse.ArgumentParser(description="Antigravity Session Manager for Codex / Peer Agents")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # send
    send_parser = subparsers.add_parser("send", help="Send a prompt to a named Antigravity session")
    send_parser.add_argument("--name", "-n", default="worker-1", help="Name of the session (e.g. worker-1, researcher)")
    send_parser.add_argument("--prompt", "-p", required=True, help="Prompt/task text to send")
    send_parser.add_argument("--new", action="store_true", help="Force start a new conversation instead of resuming")
    send_parser.add_argument("--cwd", help="Task workspace; passed to agy as --add-dir, not just the process cwd")
    send_parser.add_argument("--model", help="Specific model to use")
    send_parser.add_argument("--effort", choices=["low", "medium", "high"], help="Reasoning effort level")
    send_parser.add_argument("--mode", default="accept-edits", choices=["accept-edits", "plan"], help="Agent execution mode")
    send_parser.add_argument("--print-timeout", default=DEFAULT_PRINT_TIMEOUT, help=f"Worker time budget, e.g. 90m (default {DEFAULT_PRINT_TIMEOUT})")
    send_parser.add_argument("--add-dir", action="append", help="Extra workspace directory (repeatable)")
    send_parser.add_argument("--json", action="store_true", help="Output full JSON response")

    # list
    list_parser = subparsers.add_parser("list", help="List all active named sessions")
    list_parser.add_argument("--json", action="store_true", help="Output JSON")

    # show
    show_parser = subparsers.add_parser("show", help="Show session details")
    show_parser.add_argument("--name", "-n", required=True, help="Session name")
    show_parser.add_argument("--json", action="store_true", help="Output JSON")

    # reset
    reset_parser = subparsers.add_parser("reset", help="Reset/clear a session's context")
    reset_parser.add_argument("--name", "-n", required=True, help="Session name to reset")

    args = parser.parse_args()

    if args.command == "send":
        cmd_send(args)
    elif args.command == "list":
        cmd_list(args)
    elif args.command == "show":
        cmd_show(args)
    elif args.command == "reset":
        cmd_reset(args)


if __name__ == "__main__":
    main()
