"""
crnotes.py — open review notes on the Comprehensive Rules, as a live overlay.

Readers comment on the rules review page (`/?crreview=1`); the game server keeps
the threads (client/server/crreview.ts) and serves them at GET /api/cr/comments.
An OPEN thread opened by an account with an owner or judge badge is a flag that
the rule it sits on may be wrong and is waiting to be fixed. When the judge
retrieves that rule, the model should know — so this module fetches the threads
every ten minutes and core.build_context appends each matching note to the rule's
passage:

    ⚠ Open review note (owner, 2026-10-10): <body>

⚠ A NOTE IS A LEAD, NOT A SOURCE (the CR README, "How to apply a review
comment": "A comment is a lead, not a source, even from a judge or the owner").
SYSTEM_PROMPT tells the model to mention the uncertainty and to prefer higher
sources, never to state the note as the rule.

WHAT COUNTS. A ROOT comment (replies are discussion), not deleted, not resolved,
whose author carries `by.owner` or `by.judge`, on a target the corpus can
match: `rule:<key>`, `gloss:<key>` or `sec:<num>`. Discrepancy and finding
threads are not rules and are left out.

THE FETCH NEVER BLOCKS AN ANSWER. Answers read the last good snapshot from
memory; the refresh is its own task on the running event loop, started the
first time anything asks (`ensure_started()`). The game server unreachable, a
non-JSON body, a refusal: the snapshot empties, the answer goes out without
notes, nothing is raised. The notes are live data, so they are not part of
core.ENGINE_VERSION; the ids used are logged per answer (responses.jsonl
`cr_notes`).

ENABLED where the bot↔server integration is: ALGO_BOT_TOKEN set (unset means the
integration is absent, CLAUDE.md), unless ALGO_CR_NOTES says "on" or "off".
The base URL is gameserver.BASE (ALGO_GAME_SERVER).
"""

from __future__ import annotations

import asyncio
import os
import time

REFRESH_S = 600            # ten minutes
NOTE_MAX_CHARS = 600       # a long body is cut; the note is a flag, not an essay
TARGET_KINDS = ("rule", "gloss", "sec")


def enabled() -> bool:
    flag = (os.getenv("ALGO_CR_NOTES") or "").strip().lower()
    if flag in ("on", "1", "true", "yes"):
        return True
    if flag in ("off", "0", "false", "no"):
        return False
    return bool(os.getenv("ALGO_BOT_TOKEN"))


# ── the server's fold, for a journal copy (tests, and a local file) ─────────
# The live route already folds (api-crreview.ts viewFor(fold(...))). This is
# the same fold in Python so a COPY of var/cr-comments.jsonl reads the same way:
# it must agree with client/server/crreview.ts fold() on what is open.

def _may_change(c: dict, actor: dict) -> bool:
    return not c.get("deleted") and (c["by"].get("id") == actor["id"] or actor["admin"])


def fold_rows(rows) -> list[dict]:
    """Journal rows -> comments, in the order added, shaped like the route's
    answer (`by` without the account id). Mirrors crreview.ts fold()."""
    out: dict[str, dict] = {}
    for r in rows:
        if not isinstance(r, dict) or not isinstance(r.get("id"), str) or not isinstance(r.get("by"), dict):
            continue
        actor = {"id": r["by"].get("id"), "admin": r.get("asAdmin") is True}
        op = r.get("op")
        if op == "add":
            if r["id"] in out or not isinstance(r.get("target"), str) or not isinstance(r.get("body"), str):
                continue
            parent = r.get("parent") if isinstance(r.get("parent"), str) else None
            if parent is not None:
                p = out.get(parent)
                if not p or p["parent"] is not None or p.get("deleted") or p["target"] != r["target"]:
                    continue
            out[r["id"]] = {"id": r["id"], "target": r["target"], "parent": parent,
                            "body": r["body"], "by": r["by"], "at": r.get("at", "")}
            continue
        c = out.get(r["id"])
        if not c:
            continue
        if op == "edit":
            if isinstance(r.get("body"), str) and _may_change(c, actor):
                c["body"] = r["body"]
        elif op == "delete":
            if _may_change(c, actor):
                c.update(deleted=True, body="")
                c.pop("resolved", None)
        elif op in ("resolve", "reopen"):
            if c["parent"] is None and _may_change(c, actor):
                if op == "resolve":
                    c["resolved"] = {"by": r["by"].get("name"), "at": r.get("at", "")}
                else:
                    c.pop("resolved", None)
    view = []
    for c in out.values():
        by = c["by"]
        v = {k: c[k] for k in ("id", "target", "parent", "body", "at") if k in c}
        v["by"] = {"name": by.get("name"), **({"owner": True} if by.get("owner") else {}),
                   **({"judge": by["judge"]} if by.get("judge") else {})}
        for k in ("resolved", "deleted"):
            if k in c:
                v[k] = c[k]
        view.append(v)
    return view


# ── what is kept ────────────────────────────────────────────────────────────

def select_open(comments) -> dict[str, list[dict]]:
    """The route's comments -> {target: [note]} for open, badge-authored roots
    on rule/gloss/sec targets. A note is {id, target, role, date, body}."""
    out: dict[str, list[dict]] = {}
    for c in comments or []:
        if not isinstance(c, dict) or c.get("parent") is not None:
            continue
        if c.get("deleted") or c.get("resolved") or not (c.get("body") or "").strip():
            continue
        by = c.get("by") or {}
        if not (by.get("owner") or by.get("judge")):
            continue
        target = c.get("target") or ""
        if target.split(":", 1)[0] not in TARGET_KINDS or ":" not in target:
            continue
        body = " ".join(c["body"].split())
        if len(body) > NOTE_MAX_CHARS:
            body = body[:NOTE_MAX_CHARS].rsplit(" ", 1)[0] + "…"
        out.setdefault(target, []).append({
            "id": c["id"], "target": target, "role": "owner" if by.get("owner") else "judge",
            "date": str(c.get("at") or "")[:10], "body": body,
        })
    return out


def targets_of(row: dict) -> list[str]:
    """The comment targets a corpus chunk answers to (CR chunks only)."""
    if row.get("source_type") != "cr":
        return []
    m = row.get("metadata") or {}
    if m.get("kind") == "glossary":
        return [f"gloss:{m['gloss_key']}"] if m.get("gloss_key") else []
    out = [f"rule:{k}" for k in m.get("keys") or []]
    if m.get("section"):
        out.append(f"sec:{m['section']}")
    return out


def format_note(n: dict) -> str:
    return f"⚠ Open review note ({n['role']}, {n['date']}): {n['body']}"


class CrNotes:
    """The last good snapshot of open notes, and the task that refreshes it."""

    def __init__(self, fetch=None, interval=REFRESH_S):
        # fetch: an async callable returning the route's JSON body (a dict)
        self._fetch = fetch
        self.interval = interval
        self.by_target: dict[str, list[dict]] = {}
        self.fetched_at: float | None = None
        self.last_error: str | None = None
        self._task: asyncio.Task | None = None
        self._loop = None

    async def _default_fetch(self):
        import gameserver           # aiohttp; imported late so a test needs neither
        gs = gameserver.GameServer()
        try:
            return await gs._get("/api/cr/comments")
        finally:
            await gs.close()

    async def refresh(self) -> bool:
        """One fetch. True if it worked; on ANY failure the snapshot empties
        (a resolved note must not linger because the server went away)."""
        try:
            body = await (self._fetch or self._default_fetch)()
            if not isinstance(body, dict) or not isinstance(body.get("comments"), list):
                raise ValueError("no comments list in the answer")
            self.by_target = select_open(body["comments"])
            self.fetched_at = time.time()
            self.last_error = None
            return True
        except Exception as exc:          # unreachable server = no overlay, never an error
            self.by_target = {}
            self.last_error = f"{type(exc).__name__}: {exc}"
            return False

    async def _run(self):
        while True:
            await self.refresh()
            await asyncio.sleep(self.interval)

    def ensure_started(self) -> None:
        """Start the refresh loop on the running event loop, once per loop. A
        no-op outside a loop, when disabled, or when it is already running."""
        if not enabled() and self._fetch is None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        if self._task is not None and not self._task.done() and self._loop is loop:
            return
        self._loop = loop
        self._task = loop.create_task(self._run())

    def notes_for(self, row: dict) -> list[dict]:
        seen, out = set(), []
        for t in targets_of(row):
            for n in self.by_target.get(t, []):
                if n["id"] not in seen:
                    seen.add(n["id"])
                    out.append(n)
        return out


#: the process's one overlay; core reads it
NOTES = CrNotes()
