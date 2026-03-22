#!/usr/bin/env bash
# Local CodeQL security scan for JavaScript/TypeScript
# Usage: ./scripts/codeql-scan.sh [--full|--quick] [--sarif <path>]
#
# --quick  (default) Security-extended queries only
# --full   Security-and-quality queries (slower, more findings)
# --sarif  Write SARIF output to a file (default: .codeql/results.sarif)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_DIR="$REPO_ROOT/.codeql/db"
RESULTS_DIR="$REPO_ROOT/.codeql"
SARIF_PATH="$RESULTS_DIR/results.sarif"
SUITE="codeql-suites/javascript-security-extended.qls"
THREADS=0  # auto-detect

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --full) SUITE="codeql-suites/javascript-security-and-quality.qls"; shift ;;
    --quick) SUITE="codeql-suites/javascript-security-extended.qls"; shift ;;
    --sarif) SARIF_PATH="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Check CodeQL CLI is installed
if ! command -v codeql &>/dev/null; then
  echo "Error: codeql CLI not found. Install from https://github.com/github/codeql-cli-binaries/releases"
  exit 1
fi

# Ensure query pack is installed
if ! codeql resolve packs 2>/dev/null | grep -q "codeql/javascript-queries"; then
  echo "Downloading CodeQL JavaScript query pack..."
  codeql pack download codeql/javascript-queries
fi

mkdir -p "$RESULTS_DIR"

echo "=== CodeQL Local Security Scan ==="
echo "Suite: $SUITE"
echo ""

# Step 1: Create database
echo "[1/3] Creating CodeQL database..."
codeql database create "$DB_DIR" \
  --language=javascript \
  --source-root="$REPO_ROOT" \
  --overwrite \
  --threads="$THREADS" \
  2>&1 | grep -E "^(Successfully|Finalizing|Running|Finished|Error)" || true

# Step 2: Analyze
echo "[2/3] Running security analysis..."
codeql database analyze "$DB_DIR" \
  "codeql/javascript-queries:$SUITE" \
  --format=sarif-latest \
  --output="$SARIF_PATH" \
  --threads="$THREADS" \
  2>&1 | grep -E "^(Shutting|Interpreting|CodeQL scanned|Error)" || true

# Step 3: Parse results
echo "[3/3] Parsing results..."
echo ""

python3 - "$SARIF_PATH" <<'PYEOF'
import json, sys
from collections import Counter

with open(sys.argv[1]) as f:
    sarif = json.load(f)

results = sarif["runs"][0]["results"]

# Filter out noisy false-positive rules
SUPPRESSED = {"js/missing-rate-limiting"}
actionable = [r for r in results if r["ruleId"] not in SUPPRESSED]
suppressed_count = len(results) - len(actionable)

errors = [r for r in actionable if r.get("level") == "error"]
warnings = [r for r in actionable if r.get("level") != "error"]

by_rule = Counter(r["ruleId"] for r in actionable)

print(f"Total findings: {len(results)} ({suppressed_count} suppressed, {len(actionable)} actionable)")
print(f"  Errors:   {len(errors)}")
print(f"  Warnings: {len(warnings)}")
print()

if actionable:
    print("By rule:")
    for rule, count in by_rule.most_common():
        print(f"  {count:3d}  {rule}")
    print()

    # Show details for errors and top warnings
    shown = errors + warnings[:20]
    if shown:
        print("Details (top 20):")
        for r in shown:
            loc = r.get("locations", [{}])[0].get("physicalLocation", {})
            uri = loc.get("artifactLocation", {}).get("uri", "?")
            line = loc.get("region", {}).get("startLine", "?")
            level = r.get("level", "warning")
            msg = r["message"]["text"].split("\n")[0][:120]
            print(f"  [{level}] {r['ruleId']}")
            print(f"    {uri}:{line}")
            print(f"    {msg}")
            print()

if errors:
    print(f"FAIL: {len(errors)} error(s) found")
    sys.exit(1)
else:
    print(f"PASS: No errors. {len(warnings)} warning(s) to review.")
    print(f"SARIF: {sys.argv[1]}")
    sys.exit(0)
PYEOF
