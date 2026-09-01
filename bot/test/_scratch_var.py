"""Point this test process's runtime state at a throwaway directory.

WHY THIS EXISTS
---------------
`var/` is the deployment's live data: the AI answer log that is the training
record, the feedback that is the eval set, the colour-combo games real people
played, the puzzle attempts. It is gitignored, unbackupable and cannot be
rebuilt — CLAUDE.md is explicit about it.

The bot's tests used to write straight into it. `test_wtp.py` POSTs to
/api/wtp/attempt, which reaches `store.log_wtp`, which appended a row to
`var/logs/wtp_attempts.jsonl` — on whatever machine the suite ran, including
the deploy box, where `bot.py` and `app.py` are systemd units serving real
users. Recorded as pre-existing in d73ffd0 and not fixed then. Measured before
fixing it, 2026-09-01: **136 of the 247 rows** in that file carried the tests'
own session ids (`t1`, `fresh-user`, `someone-else`) — 55% of a file nothing
can reconstruct.

The client side solved the identical problem with per-file env overrides
(`client/server/statepaths.ts`, and `suite.test.ts` which gives every spawned
server its own scratch paths). This is the same seam for the Python half:
`bot/paths.py` reads `ALGO_VAR_DIR` at call time, so importing this module
before anything else in the bot package redirects every log the run can write.

HOW TO USE IT
-------------
Import it FIRST, above every bot import, in the same preamble block that puts
`bot/` on `sys.path`:

    import _scratch_var          # noqa: F401  — must precede any bot import
    import wtp

⚠ ORDER IS THE WHOLE THING. `paths.py`'s getters read the variable on every
call, so a late import still works today — but `store.py` and anything else
that binds a path at module scope would already have the real one. Importing
this first makes the redirect true for every style of consumer, not just the
careful ones.

The directory is removed when the process exits. It is under the system temp
dir, never under `var/`: nothing here deletes anything the deployment owns.
"""

import atexit
import os
import shutil
import tempfile

#: the throwaway var/ this process writes to instead of the real one
SCRATCH = tempfile.mkdtemp(prefix="algo-bot-test-")
os.environ["ALGO_VAR_DIR"] = SCRATCH


@atexit.register
def _cleanup() -> None:
    shutil.rmtree(SCRATCH, ignore_errors=True)


def scratch_var_dir() -> str:
    """Where this process's runtime state is going, for a test that wants to
    assert it really was redirected."""
    return SCRATCH
