#!/usr/bin/env python3
"""
run_all.py — every bot test, as one command with one exit code.

⚠ THIS IS THE GATE `npm run check` NEVER HAD. CLAUDE.md said it in capitals:
"npm run check does not run any of them. Nothing in the repo does." That is
how the puzzle command stayed broken from July to September, and it is the
hole both of 2026-09-03's regressions came through — every draft button
raising NameError, every queue match raising AttributeError — while all the
scripts stayed green because nothing ran them together, and nothing ran
them at all unless somebody remembered.

Each script is its own process (they each redirect var/ to a scratch dir
through _scratch_var.py and print their own pass line; that stays). This
runs them in order, shows each one's last line, and exits non-zero if any
did. `npm --prefix client run test:py` reaches it; `check` runs it after the
TypeScript suites.

    .venv/bin/python bot/test/run_all.py          # all eight
    .venv/bin/python bot/test/run_all.py slash    # just test_slash.py
"""

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PYTHON = sys.executable


def main(argv: list[str]) -> int:
    scripts = sorted(HERE.glob("test_*.py"))
    if argv:
        scripts = [s for s in scripts if any(a in s.stem for a in argv)]
    if not scripts:
        print("run_all: no test scripts matched", file=sys.stderr)
        return 2
    failed: list[str] = []
    for script in scripts:
        proc = subprocess.run([PYTHON, str(script)], capture_output=True, text=True)
        out = (proc.stdout + proc.stderr).rstrip().splitlines()
        # the pass line is the script's last STDOUT line; stderr carries warnings
        said = proc.stdout.rstrip().splitlines()
        last = said[-1] if said else (out[-1] if out else "(no output)")
        mark = "✓" if proc.returncode == 0 else "✗"
        print(f"  {mark} {script.name:<24} {last}")
        if proc.returncode != 0:
            failed.append(script.name)
            # the whole transcript, once, so the failing check is on screen
            print("\n".join("      " + ln for ln in out))
    print()
    if failed:
        print(f"run_all: {len(failed)} of {len(scripts)} FAILED — {', '.join(failed)}")
        return 1
    print(f"run_all: all {len(scripts)} bot test scripts passed ✅")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
