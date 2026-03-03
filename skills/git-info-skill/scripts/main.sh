#!/usr/bin/env bash
set -euo pipefail

# Read all stdin
INPUT=$(cat)

# Parse input JSON and dispatch to the appropriate action
python3 -c '
import json, subprocess, sys, os

def run_git(args):
    """Run a git command and return stdout."""
    try:
        result = subprocess.run(
            ["git"] + args,
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            return None, result.stderr.strip()
        return result.stdout, None
    except subprocess.TimeoutExpired:
        return None, "Git command timed out"
    except Exception as e:
        return None, str(e)

def error_out(msg):
    print(json.dumps({"error": msg}))
    sys.exit(0)

# Parse input
try:
    data = json.loads(sys.stdin.read()) if not os.environ.get("_INPUT") else json.loads(os.environ["_INPUT"])
except Exception:
    try:
        data = json.loads('"'"''"'"' + os.environ.get("_INPUT", "{}") + '"'"''"'"')
    except Exception:
        error_out("Failed to parse input JSON")

if not isinstance(data, dict):
    error_out("Input must be a JSON object")

action = data.get("action", "")
path = data.get("path")
count = data.get("count", 10)
ref = data.get("ref")
from_ref = data.get("from_ref")
to_ref = data.get("to_ref", "HEAD")

if not action:
    error_out("Missing required field: action")

# Verify we are in a git repository
check, err = run_git(["rev-parse", "--is-inside-work-tree"])
if err:
    error_out(f"Not a git repository: {err}")

if action == "log":
    args = ["log", f"-{count}", "--format=%H|%h|%an|%aI|%s"]
    if ref:
        args.append(ref)
    out, err = run_git(args)
    if err:
        error_out(f"git log failed: {err}")
    commits = []
    for line in out.strip().split("\n"):
        if not line:
            continue
        parts = line.split("|", 4)
        if len(parts) == 5:
            commits.append({
                "hash": parts[0],
                "short_hash": parts[1],
                "author": parts[2],
                "date": parts[3],
                "message": parts[4],
            })
    print(json.dumps({"commits": commits}))

elif action == "diff":
    diff_args = ["diff"]
    if from_ref:
        if to_ref:
            diff_args.append(f"{from_ref}..{to_ref}")
        else:
            diff_args.append(from_ref)
    if path:
        diff_args.extend(["--", path])

    out, err = run_git(diff_args)
    if err:
        error_out(f"git diff failed: {err}")

    # Get stat summary
    stat_args = ["diff", "--stat"]
    if from_ref:
        if to_ref:
            stat_args.append(f"{from_ref}..{to_ref}")
        else:
            stat_args.append(from_ref)
    if path:
        stat_args.extend(["--", path])

    stat_out, _ = run_git(stat_args)

    files_changed = 0
    insertions = 0
    deletions = 0
    if stat_out:
        last_line = stat_out.strip().split("\n")[-1] if stat_out.strip() else ""
        import re
        fc = re.search(r"(\d+) files? changed", last_line)
        ins = re.search(r"(\d+) insertions?", last_line)
        dels = re.search(r"(\d+) deletions?", last_line)
        if fc: files_changed = int(fc.group(1))
        if ins: insertions = int(ins.group(1))
        if dels: deletions = int(dels.group(1))

    print(json.dumps({
        "diff": out,
        "files_changed": files_changed,
        "insertions": insertions,
        "deletions": deletions,
    }))

elif action == "branches":
    out, err = run_git(["branch", "-a"])
    if err:
        error_out(f"git branch failed: {err}")

    current = ""
    branches = []
    for line in out.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("* "):
            branch_name = line[2:].strip()
            current = branch_name
            branches.append(branch_name)
        else:
            branches.append(line)

    print(json.dumps({"current": current, "branches": branches}))

elif action == "status":
    out, err = run_git(["status", "--porcelain", "-b"])
    if err:
        error_out(f"git status failed: {err}")

    branch = ""
    staged = []
    modified = []
    untracked = []

    for line in out.strip().split("\n"):
        if not line:
            continue
        if line.startswith("## "):
            branch_info = line[3:]
            branch = branch_info.split("...")[0] if "..." in branch_info else branch_info
        elif len(line) >= 3:
            x = line[0]
            y = line[1]
            fname = line[3:]
            if x in ("A", "M", "D", "R", "C"):
                staged.append(fname)
            if y == "M":
                modified.append(fname)
            if x == "?" and y == "?":
                untracked.append(fname)

    clean = len(staged) == 0 and len(modified) == 0 and len(untracked) == 0

    print(json.dumps({
        "branch": branch,
        "clean": clean,
        "staged": staged,
        "modified": modified,
        "untracked": untracked,
    }))

elif action == "blame":
    if not path:
        error_out("blame requires a path")
    out, err = run_git(["blame", "--porcelain", path])
    if err:
        error_out(f"git blame failed: {err}")

    lines = []
    current_hash = ""
    current_author = ""
    current_date = ""
    current_line_no = 0
    line_count = 0

    for raw_line in out.split("\n"):
        if line_count >= 200:
            break
        # Header line: hash orig_line final_line [num_lines]
        parts = raw_line.split()
        if len(parts) >= 3 and len(parts[0]) == 40:
            current_hash = parts[0]
            current_line_no = int(parts[2])
        elif raw_line.startswith("author "):
            current_author = raw_line[7:]
        elif raw_line.startswith("author-time "):
            import datetime
            ts = int(raw_line[12:])
            current_date = datetime.datetime.fromtimestamp(ts).isoformat()
        elif raw_line.startswith("\t"):
            content = raw_line[1:]
            lines.append({
                "hash": current_hash[:8],
                "author": current_author,
                "date": current_date,
                "line_number": current_line_no,
                "content": content,
            })
            line_count += 1

    print(json.dumps({"lines": lines}))

elif action == "show":
    show_ref = ref or "HEAD"
    out, err = run_git(["show", "--format=%H%n%an%n%aI%n%B", show_ref])
    if err:
        error_out(f"git show failed: {err}")

    parts = out.split("\n", 3)
    if len(parts) >= 4:
        hash_val = parts[0]
        author = parts[1]
        date = parts[2]
        rest = parts[3]
        # Message ends at first "diff --git" line
        diff_start = rest.find("diff --git")
        if diff_start >= 0:
            message = rest[:diff_start].strip()
            diff = rest[diff_start:]
        else:
            message = rest.strip()
            diff = ""
    else:
        hash_val = parts[0] if len(parts) > 0 else ""
        author = parts[1] if len(parts) > 1 else ""
        date = parts[2] if len(parts) > 2 else ""
        message = ""
        diff = ""

    print(json.dumps({
        "hash": hash_val,
        "author": author,
        "date": date,
        "message": message,
        "diff": diff,
    }))

else:
    error_out(f"Unknown action: {action}. Valid actions: log, diff, branches, status, blame, show")
' <<< "$INPUT"
