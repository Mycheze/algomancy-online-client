#!/usr/bin/env python3
"""
test_review_questions.py — BL-17, the judges' review queue, bot half:
store.recent_answers() and app.py's GET /api/review/questions.

  §1 newest first, a failed call left out, the players' latest rating joined,
     no user id of any kind in a row
  §2 a follow-up carries its last turns, trimmed; long text is capped
  §3 the tail reader: rows far bigger than one read block, and `limit`
  §4 the route: 404 without ALGO_BOT_TOKEN, 404 on the wrong token, the rows
     with the right one

Run: `.venv/bin/python bot/test/test_review_questions.py`. No network, no key.
"""

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
# ⚠ BEFORE ANY BOT IMPORT — see _scratch_var.py
import _scratch_var  # noqa: F401,E402

import json  # noqa: E402
import os  # noqa: E402

import store  # noqa: E402
from paths import responses_log, feedback_log  # noqa: E402

PASS = 0


def check(cond, what):
    global PASS
    if not cond:
        raise SystemExit(f"FAIL  {what}")
    PASS += 1
    print(f"  ok  {what}")


def reset():
    for p in (responses_log(), feedback_log()):
        if p.exists():
            p.unlink()


def answer(q, a, *, user="u1", channel="web", history=None, hits=None):
    rid = store.new_response_id()
    store.log_response(rid, "followup" if history else "ask", q, a, hits or [], "m",
                       user_id=user, channel_id=channel, history=history)
    return rid


# §1
reset()
r1 = answer("Can a Fight target my own unit?", "Yes.", user="alice-discord-id", channel="12345")
store.log_failure("ask", "a question that never got an answer", RuntimeError("down"), "m",
                  user_id="bob", channel_id="web")
r2 = answer("Does haste let a unit attack the turn it spawns?", "Yes, it does.")
store.log_feedback(r1, "good", "x")
store.log_feedback(r1, "bad", "y")
rows = store.recent_answers(10)
check([r["id"] for r in rows] == [r2, r1], "§1 newest first, the failed call left out")
check(rows[1]["surface"] == "discord" and rows[0]["surface"] == "web", "§1 the surface is web or discord")
check(rows[1].get("rating") == "bad" and "rating" not in rows[0], "§1 the latest rating is joined, none when nobody rated")
blob = json.dumps(rows)
check("user_id" not in blob and "alice-discord-id" not in blob and "channel_id" not in blob,
      "§1 no user id or channel id in any row")
check("retrieved" not in rows[0], "§1 the retrieved chunks stay in the log")

# §2
reset()
long_turn = "x" * (store.REVIEW_TURN_MAX + 50)
hist = [{"role": "user", "content": f"turn {i} " + long_turn} for i in range(6)]
r3 = answer("and then?", "y" * (store.REVIEW_TEXT_MAX + 10), history=hist)
row = store.recent_answers(5)[0]
check(row["id"] == r3 and row["kind"] == "followup", "§2 a follow-up is listed as one")
check(len(row["history"]) == store.REVIEW_TURNS and row["history"][0]["content"].startswith("turn 2"),
      "§2 it carries its last turns only")
check(all(len(t["content"]) == store.REVIEW_TURN_MAX for t in row["history"]), "§2 each turn is trimmed")
check(len(row["answer"]) == store.REVIEW_TEXT_MAX, "§2 a long answer is capped")

# §3
reset()
big = [(9.0 - i, {"id": f"c{i}", "authority": 1, "source_type": "cr", "source": "s", "title": "t",
                  "text": "z" * 40000}) for i in range(3)]
ids = [answer(f"question {i}", f"answer {i}", hits=big) for i in range(12)]
check(responses_log().stat().st_size > 12 * 100000, "§3 the fixture rows are each bigger than a read block")
rows = store.recent_answers(5)
check([r["id"] for r in rows] == list(reversed(ids))[:5], "§3 the last five, newest first, across block edges")
check([r["id"] for r in store.recent_answers(100)] == list(reversed(ids)), "§3 a limit past the start reads the first row too")
check(store.recent_answers(5)[4]["question"] == "question 7", "§3 a row read across a block edge parses whole")

# §4
from fastapi.testclient import TestClient  # noqa: E402
import app as webapp  # noqa: E402

os.environ.pop("ALGO_BOT_TOKEN", None)
with TestClient(webapp.app) as client:
    check(client.get("/api/review/questions").status_code == 404, "§4 no token configured: 404")
    check(client.get("/api/review/questions", headers={"x-algo-bot": ""}).status_code == 404,
          "§4 no token configured, an empty header: still 404")
    os.environ["ALGO_BOT_TOKEN"] = "s3cret"
    try:
        check(client.get("/api/review/questions").status_code == 404, "§4 no header: 404")
        check(client.get("/api/review/questions", headers={"x-algo-bot": "wrong"}).status_code == 404,
              "§4 the wrong token: 404")
        ok = client.get("/api/review/questions?limit=3", headers={"x-algo-bot": "s3cret"})
        check(ok.status_code == 200 and [r["id"] for r in ok.json()["questions"]] == list(reversed(ids))[:3],
              "§4 the right token: the last answers")
    finally:
        os.environ.pop("ALGO_BOT_TOKEN", None)

print(f"\nALL {PASS} CHECKS PASSED")
