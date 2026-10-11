#!/usr/bin/env python3
"""
test_cr.py — the Comprehensive Rules in the judge bot, offline.
Run: `.venv/bin/python bot/test/test_cr.py`. No network, no key, no game server.

What it pins, and why each one matters:
- CHUNKING (pipeline/build_cr.py): one chunk per numbered rule with its
  subrules and printed examples, headed by chapter and section; a cut between
  subrules where the size or the authority tier changes, the later piece
  repeating its head rule; every live rule in exactly one chunk; no raw rule key
  left in any text (the renderer resolves them — Python must never re-number).
- AUTHORITY: the CR never outranks tier 0 (Discord/RAQ rulings) and only its
  printed/designer/mixed rules sit level with the Manual; owner calls and
  digital-client conventions are tier 2 with their own labels.
- STALE CORPUS CONTENT the gold-set drafter found is cut or flagged (tokens are
  not trashed; the Wraith self-pick is settled; the old glossary's Conjure,
  Historic, Skirmish, discard-only mods and draft-pool return; Worldbender's
  outdated oracle ruling).
- SURFACE: a digital-client convention reads "how the online client plays" on
  the web and "in the online client; tabletop may differ" on Discord.
- CITATION LINKS: a CR source links to the rules review page at that rule
  (`r608.2b`, Annex D `rD6.16`, a glossary row `gloss:<key>`), in the Discord
  legend, the web payload and nowhere for a non-CR source.
- THE OPEN-REVIEW-NOTE OVERLAY (crnotes.py): the server's fold semantics
  (open / resolved / reopened / deleted / who may do what), the owner/judge
  badge filter, the target filter, the note in the passage and its id in the
  log, and an unreachable server meaning no overlay and no error.
"""

# ── reaching the bot package ──────────────────────────────────────────
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent / "pipeline"))
# ⚠ BEFORE ANY BOT IMPORT: redirect var/ to a throwaway directory.
import _scratch_var  # noqa: F401,E402
# ──────────────────────────────────────────────────────────────────────

import asyncio
import json
import os
import re
import socket
from types import SimpleNamespace as NS

os.environ.pop("ALGO_BOT_TOKEN", None)       # the overlay's own enable switch: off unless a test says
os.environ.pop("ALGO_CR_NOTES", None)

import build_corpus                           # noqa: E402
import build_cr                               # noqa: E402
import core                                   # noqa: E402
import crnotes                                # noqa: E402
import store                                  # noqa: E402
from paths import CORPUS, CR_JSON, REPO_ROOT, responses_log   # noqa: E402

PASS = 0


def check(name, cond):
    global PASS
    assert cond, f"FAIL: {name}"
    PASS += 1
    print(f"  ok  {name}")


mk = build_corpus.make_record


def row(num, text, *, basis="printed", scope=None, examples=(), title=None, section="608",
        sectionTitle="Combat Damage Step", chapter="6. Regions, Formations and Battle",
        key=None, openQ=False, differs=False, verdict="confirmed", see=()):
    import re as _re
    m = _re.match(r"^(\d{3}|D\d+)(?:\.(\d+)([a-z]*))?$", num)
    parent = f"{m.group(1)}.{m.group(2)}" if m.group(3) else m.group(1)
    return {"num": num, "key": key or f"k.{num}", "title": title, "section": section,
            "sectionTitle": sectionTitle, "chapterTitle": chapter, "parent": parent,
            "text": text, "see": list(see), "examples": list(examples), "basis": basis,
            "scope": scope, "engineDiffers": differs, "discrepancies": [], "openQuestion": openQ,
            "untested": False, "verdict": verdict}


# ── 1. chunking ─────────────────────────────────────────────────────────
print("chunking")
fixture = [
    row("608.1", "The step begins.", examples=["A 2/2 attacks."]),
    row("608.2", "Damage has three sub-steps.", title="Sub-steps", see=("802.4",)),
    row("608.2a", "Swift strikes first."),
    row("608.2b", "The owner decided this.", basis="owner", openQ=True),
    row("608.2c", "The engine differs here.", basis="owner", differs=True, verdict="partial"),
    row("608.2d", "Back to print.", basis="mixed"),
]
recs = build_cr.chunk_rows(fixture, mk)
ids = [r["id"] for r in recs]
check("a rule with no subrules is one chunk; a tier change cuts the group",
      ids == ["cr:608.1", "cr:608.2", "cr:608.2b", "cr:608.2d"])
by = {r["id"]: r for r in recs}
check("the chunk carries its examples and its section header",
      "Example: A 2/2 attacks." in by["cr:608.1"]["text"]
      and by["cr:608.1"]["text"].startswith("Comprehensive Rules (unofficial) · 6. Regions, Formations and Battle › 608. Combat Damage Step"))
check("a head rule's title and See line print", "608.2 Sub-steps. Damage has three sub-steps. See rule 802.4." in by["cr:608.2"]["text"])
check("608.2 holds 608.2a (same tier)", by["cr:608.2"]["metadata"]["nums"] == ["608.2", "608.2a"])
check("a continuation piece repeats its head rule", "(continues 608.2: Damage has three sub-steps.)" in by["cr:608.2b"]["text"])
check("owner-basis subrules are cr_owner, tier 2",
      by["cr:608.2b"]["authority"] == 2 and "owner call" in by["cr:608.2b"]["authority_label"])
check("an open question is marked in the text and the metadata",
      "[Open question:" in by["cr:608.2b"]["text"] and by["cr:608.2b"]["metadata"]["open_question"])
check("engineDiffers and a partial verdict are marked",
      "currently plays 608.2c differently" in by["cr:608.2b"]["text"] and "only partial" in by["cr:608.2b"]["text"])
check("mixed basis is cr, tier 1", by["cr:608.2d"]["authority"] == 1 and by["cr:608.2d"]["authority_label"] == "Comprehensive Rules (unofficial)")

long = [row("608.3", "Head.")] + [row(f"608.3{c}", "x " * 400) for c in "abc"]
pieces = build_cr.chunk_rows(long, mk, max_chars=1000)
check("an oversized group is cut between subrules, never inside one",
      [p["metadata"]["nums"] for p in pieces] == [["608.3", "608.3a"], ["608.3b"], ["608.3c"]])

dig = build_cr.chunk_rows([row("D6.16", "The clock pauses.", section="D6", basis="owner"),
                           row("100.4", "Two players only.", section="100", scope="digital")], mk)
check("Annex D and scope 'digital' rules are cr_digital, tier 2",
      all(r["authority"] == 2 and "digital-client convention" in r["authority_label"]
          and r["metadata"]["scope"] == "digital" for r in dig))
ov = build_cr.chunk_rows([row("100.4", "Two players only.", section="100", key="concepts.x")], mk,
                         scope_override={"concepts.x": {"scope": "digital"}})
check("a scope override map (local experiments only) is honoured", ov[0]["metadata"]["scope"] == "digital")
gl = build_cr.chunk_glossary([{"term": "Clock", "key": "glossary.clock", "obsolete": False,
                               "text": "The timer.", "see": ["D6.16"]}],
                             {"D6.16": row("D6.16", "x", section="D6")}, mk)
check("a glossary row is a small chunk in its target rule's tier",
      gl[0]["id"] == "cr:glossary.clock" and gl[0]["authority_label"].endswith("digital-client convention)")
      and "Clock: The timer. See rule D6.16." in gl[0]["text"])

doc = json.loads(CR_JSON.read_text())
real = build_cr.build_cr(CR_JSON, scope_override={})
rule_chunks = [r for r in real if r["metadata"]["kind"] == "rule"]
seen = [n for r in rule_chunks for n in r["metadata"]["nums"]]
allnums = [r["num"] for r in doc["rules"] + doc["annexD"]]
check(f"every one of the {len(allnums)} live rules is in exactly one chunk", sorted(seen) == sorted(allnums))
check("no two CR chunks share an id", len({r["id"] for r in real}) == len(real))
check("every glossary row is a chunk", sum(r["metadata"]["kind"] == "glossary" for r in real) == len(doc["glossary"]))
key_like = re.compile(r"\b(?:combat|concepts|annexd|zones|types|attr|turn)\.[a-z0-9-]+\.[a-z0-9.-]+\b")
check("no raw rule key survives into a chunk's text", not any(key_like.search(r["text"]) for r in real))
check("every Annex D chunk is a digital-client convention",
      all(r["authority_label"].endswith("digital-client convention)") for r in rule_chunks if r["metadata"]["num"].startswith("D")))

# ── 2. authority, in the committed corpus ───────────────────────────────
print("authority")
A = build_corpus.AUTHORITY
check("RAQ/designer rulings stay tier 0, the Manual and cards tier 1",
      A["discord_ruling"][0] == 0 and A["manual"][0] == 1 and A["card"][0] == 1)
check("CR tiers: printed/designer/mixed 1, owner call 2, digital 2",
      (A["cr"][0], A["cr_owner"][0], A["cr_digital"][0]) == (1, 2, 2))
check("the labels say unofficial", all("unofficial" in A[k][1] or "convention" in A[k][1] for k in ("cr", "cr_owner", "cr_digital")))
corpus = [json.loads(l) for l in CORPUS.open()]
cr_rows = [r for r in corpus if r["source_type"] == "cr"]
check("the committed corpus carries the CR", len(cr_rows) == len(real))
check("no CR chunk outranks tier 1", min(r["authority"] for r in cr_rows) == 1)
check("the corpus's CR matches the JSON edition chunk for chunk",
      {r["id"]: r["text"] for r in cr_rows} == {r["id"]: r["text"] for r in real})

# ── 3. stale content ────────────────────────────────────────────────────
print("stale content")
cid = {r["id"]: r for r in corpus}
alltext = "\n".join(r["text"] for r in corpus)
check("the L&D glossary says tokens are NOT trashed", "TOKENS CAN BE TRASHED" not in alltext
      and "TOKENS ARE NOT TRASHED" in cid["ld-glossary:trash-trashed"]["text"]
      and "for the purposes of triggers" in cid["ld-glossary:trash-trashed"]["text"])
check("the Wraith may choose itself, chosen as the trigger goes on the stack",
      "MAY choose itself" in cid["ld-glossary:wraith"]["text"] and "UNCONFIRMED" not in cid["ld-glossary:wraith"]["text"]
      and "chosen on resolution" not in cid["ld-glossary:wraith"]["text"])
check("the primer agrees: tokens are not trashed, the Wraith may choose itself",
      "TOKENS CAN BE" not in core.PRIMER and "TOKENS ARE NOT" in core.PRIMER and "a Wraith may choose itself" in core.PRIMER)
for t in ("conjure", "historic", "skirmish"):
    check(f"old glossary {t}: flagged obsolete and outdated",
          cid[f"glossary:{t}"]["outdated_risk"] and cid[f"glossary:{t}"]["text"].startswith("[OBSOLETE:"))
check("old glossary Augment/Graft: no discard-only, no draft pool, no graft on top",
      not any(s in cid["glossary:augment"]["text"] + cid["glossary:graft"]["text"]
              for s in ("must be in your discard", "draft pool", "on top or beneath")))
check("Worldbender's outdated oracle ruling is out of its chunk",
      "draft skipping" not in cid["card:Worldbender"]["text"] and not cid["card:Worldbender"]["metadata"]["has_rulings"])
build_corpus.SCRAPPED_SPANS.append(("BEGIN-X.", "END-X."))
check("a SCRAPPED span cuts start..end inclusive", build_corpus.drop_scrapped("keep BEGIN-X. gone END-X. kept") == "keep kept")
build_corpus.SCRAPPED_SPANS.pop()

# ── 4. surface wording ──────────────────────────────────────────────────
print("surface")
digital = next(r for r in cr_rows if r["metadata"]["scope"] == "digital" and r["metadata"]["kind"] == "rule")
game = next(r for r in cr_rows if r["metadata"]["scope"] == "game" and r["metadata"]["kind"] == "rule")
web = core.build_context([(1.0, digital), (0.5, game)], "web")
dis = core.build_context([(1.0, digital), (0.5, game)], "discord")
check("web: a digital convention is stated as how the online client plays", "how the game plays here" in web)
check("discord: it says 'in the online client; tabletop may differ'", "in the online client; tabletop may differ" in dis)
check("a game-scope rule carries no surface instruction",
      web.split("---")[-1].count("online client") == 0 and dis.split("---")[-1].count("tabletop") == 0)
check("the system prompt explains the CR tiers and the citation form",
      "CR 608.2b" in core.SYSTEM_PROMPT and "owner call" in core.SYSTEM_PROMPT and "LOSE to the Manual" in core.SYSTEM_PROMPT)
check("the system prompt no longer says tokens can be trashed", "tokens CAN be trashed" not in core.SYSTEM_PROMPT)


class Fake:
    def __init__(self):
        self.calls = []
        self.chat = NS(completions=self)

    async def create(self, **params):
        self.calls.append(params)
        return NS(choices=[NS(message=NS(content="An answer [cr:608.2]."), finish_reason="stop")], usage=None)


core.ai, core.ai_fallback = Fake(), None
try:
    asyncio.run(core.answer_question("q", [], surface="slack"))
    raised = False
except ValueError:
    raised = True
check("an unknown surface is refused, not silently treated as web", raised)

# ── 5. citation links ───────────────────────────────────────────────────
print("links")
r6082 = cid["cr:608.2"]
check("a CR rule links to the review page at it",
      core.cr_link(r6082) == "https://algomancy.online/?crreview=1&at=r608.2")
annex = next(r for r in cr_rows if r["metadata"].get("num", "").startswith("D"))
check("an Annex D rule's anchor is rD<n>", core.cr_link(annex) == f"https://algomancy.online/?crreview=1&at=r{annex['metadata']['num']}")
g = cid["cr:glossary.adjacent"]
check("a glossary row's anchor is gloss:<key>", core.cr_link(g) == "https://algomancy.online/?crreview=1&at=gloss:glossary.adjacent")
check("a non-CR source has no link", core.cr_link(cid["card:Worldbender"]) is None)
check("the legend names a CR source by its number", core.friendly_source(r6082) == "CR 608.2"
      and core.friendly_source(g) == "CR glossary: Adjacent")
disp, srcs = core.render_citations("Columns deal damage [cr:608.2].", [(1.0, r6082)])
check("render_citations footnotes a CR tag", disp == "Columns deal damage ¹." and srcs[0][1]["id"] == "cr:608.2")
import discordui                              # noqa: E402
emb = discordui.answer_embed("q", "Columns deal damage [cr:608.2].", [(1.0, r6082)])
field = next(f for f in emb.fields if f.name == "Sources")
check("the Discord legend is a masked link", "[CR 608.2](https://algomancy.online/?crreview=1&at=r608.2)" in field.value)
import app as webapp                          # noqa: E402
pay = webapp._sources_payload([(1, r6082), (2, cid["card:Worldbender"])])
check("the web payload carries url for a CR source, null otherwise",
      pay[0]["url"].endswith("at=r608.2") and pay[1]["url"] is None)

# ── 6. the open-review-note overlay ─────────────────────────────────────
print("review notes")
OWNER = {"id": "u-owner", "name": "mycheze", "owner": True, "judge": 1}
JUDGE = {"id": "u-judge", "name": "ref", "judge": 2}
PLAYER = {"id": "u-player", "name": "pat"}
EDITOR = {"id": "system:rules-editor", "name": "Rules editor"}
k6082 = r6082["metadata"]["keys"][0]


def add(i, by, target, body="b", parent=None, at="2026-10-10T18:30:11Z"):
    return {"v": 1, "op": "add", "id": i, "at": at, "by": by, "target": target, "parent": parent, "body": body}


def op(kind, i, by, **kw):
    return {"v": 1, "op": kind, "id": i, "at": "2026-10-11T01:00:00Z", "by": by, **kw}


rows = [
    add("c1", OWNER, f"rule:{k6082}", "Columns may be wrong here."),     # open, owner
    add("c2", JUDGE, "sec:608", "Section ordering looks off."),           # open, judge
    add("c3", PLAYER, f"rule:{k6082}", "I think this is wrong."),         # no badge
    add("c4", OWNER, "disc:D-U02-2", "Answer."),                          # not a rule target
    add("c5", OWNER, "gloss:glossary.adjacent", "Diagonals?"),            # resolved below
    add("c6", EDITOR, "gloss:glossary.adjacent", "Fixed.", parent="c5"),  # a reply
    op("resolve", "c5", OWNER),
    add("c7", OWNER, "rule:x.y", "Deleted later."), op("delete", "c7", OWNER),
    add("c8", OWNER, "rule:x.z", "Reopened."), op("resolve", "c8", OWNER), op("reopen", "c8", OWNER),
    add("c9", OWNER, "rule:x.w", "Not theirs."), op("resolve", "c9", PLAYER),          # ignored
    op("edit", "c1", PLAYER, body="hijacked"),                                           # ignored
    add("c10", OWNER, "rule:x.v", "Admin resolved."), op("resolve", "c10", PLAYER, asAdmin=True),
    add("c11", JUDGE, "rule:x.u", "reply to nothing", parent="nope"),                    # dropped
]
view = crnotes.fold_rows(rows)
sel = crnotes.select_open(view)
check("open, badge-authored roots on rule/gloss/sec targets are kept",
      sorted(sel) == sorted([f"rule:{k6082}", "sec:608", "rule:x.z", "rule:x.w"]))
check("an edit by someone else is ignored (the server's mayChange)", sel[f"rule:{k6082}"][0]["body"] == "Columns may be wrong here.")
check("a resolve by someone else is ignored, an admin's stands", "rule:x.w" in sel and "rule:x.v" not in sel)
check("resolved, deleted, replies, unbadged and disc targets are dropped",
      "gloss:glossary.adjacent" not in sel and "rule:x.y" not in sel and "disc:D-U02-2" not in sel
      and all(n["id"] != "c3" for ns in sel.values() for n in ns))
check("role and date: owner/judge, the day it was written",
      sel[f"rule:{k6082}"][0]["role"] == "owner" and sel["sec:608"][0]["role"] == "judge"
      and sel["sec:608"][0]["date"] == "2026-10-10")

journal = REPO_ROOT / "data/comprehensive-rules/build/comments/cr-comments-2026-10-11.jsonl"
if journal.exists():     # gitignored: a copy of the box's journal, on the dev machine only
    jrows = [json.loads(l) for l in journal.read_text().splitlines() if l.strip()]
    check("the box's journal copy: every owner thread resolved, so no note", crnotes.select_open(crnotes.fold_rows(jrows)) == {})
    unresolved = crnotes.select_open(crnotes.fold_rows([r for r in jrows if r["op"] != "resolve"]))
    check("... and with its resolves removed, only the owner's rule threads come back",
          unresolved and all(t.startswith("rule:") for t in unresolved)
          and all(n["role"] == "owner" for ns in unresolved.values() for n in ns))
else:
    print("  --  (no local journal copy; the fixture above covers the fold)")


async def ok_fetch():
    return {"ok": True, "rev": 1, "comments": view}


async def down_fetch():
    raise ConnectionRefusedError("nobody home")


notes = crnotes.CrNotes(fetch=ok_fetch)
check("a good fetch fills the snapshot", asyncio.run(notes.refresh()) and notes.by_target)
check("a CR chunk finds its rule and section notes",
      [n["id"] for n in notes.notes_for(r6082)] == ["c1", "c2"])
check("a non-CR chunk finds none", notes.notes_for(cid["card:Worldbender"]) == [])
crnotes.NOTES, saved = notes, crnotes.NOTES
used = []
ctx = core.build_context([(1.0, r6082)], "web", used)
check("the note is appended to the passage",
      "⚠ Open review note (owner, 2026-10-10): Columns may be wrong here." in ctx
      and "⚠ Open review note (judge, 2026-10-10): Section ordering looks off." in ctx)
check("and its ids are collected", used == ["c1", "c2"])
check("the prompt says a note is a lead, not a source", "lead" in core.SYSTEM_PROMPT and "Open review note" in core.SYSTEM_PROMPT)

core.retriever.search = lambda q, k=10, **kw: [(1.0, r6082)]
meta = {}
answer, hits, _r = asyncio.run(core.answer_question("q", [], meta=meta, surface="discord"))
check("answer_question records the surface and the note ids", meta["surface"] == "discord" and meta["cr_notes"] == ["c1", "c2"])
store.log_response("rid-cr", "ask", "q", answer, hits, "m", user_id="t", channel_id="c", llm=meta)
logged = json.loads(responses_log().read_text().splitlines()[-1])
check("responses.jsonl carries cr_notes and surface", logged["cr_notes"] == ["c1", "c2"] and logged["surface"] == "discord")

down = crnotes.CrNotes(fetch=down_fetch)
down.by_target = {"rule:x": [{"id": "stale"}]}
check("an unreachable server: refresh says False and raises nothing", asyncio.run(down.refresh()) is False)
check("... and the snapshot empties (no stale note survives)", down.by_target == {} and "nobody home" in down.last_error)
crnotes.NOTES = down
meta = {}
asyncio.run(core.answer_question("q", [], meta=meta))
check("an answer still goes out, with no notes", meta["cr_notes"] == [])

# the real fetch path against a closed port: no exception, no overlay
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
import gameserver                             # noqa: E402
gameserver.BASE = f"http://127.0.0.1:{port}"   # read at call time by GameServer()
real_notes = crnotes.CrNotes()
check("the real gameserver fetch against a closed port fails soft", asyncio.run(real_notes.refresh()) is False
      and real_notes.by_target == {})
check("disabled without ALGO_BOT_TOKEN (integration absent)", not crnotes.enabled())
os.environ["ALGO_BOT_TOKEN"] = "t"
check("enabled with it", crnotes.enabled())
os.environ["ALGO_CR_NOTES"] = "off"
check("ALGO_CR_NOTES=off wins", not crnotes.enabled())
os.environ.pop("ALGO_BOT_TOKEN"); os.environ.pop("ALGO_CR_NOTES")
crnotes.CrNotes().ensure_started()   # outside a loop: a no-op, not an error
check("ensure_started outside an event loop is a no-op", True)


async def started():
    n = crnotes.CrNotes(fetch=ok_fetch, interval=3600)
    n.ensure_started()
    n.ensure_started()               # once per loop
    await asyncio.sleep(0.05)
    t = n._task
    ok = bool(n.by_target) and t is not None and not t.done()
    t.cancel()
    return ok


check("ensure_started runs the refresh on the loop, once", asyncio.run(started()))
crnotes.NOTES = saved

print(f"\n{PASS} checks passed ✅")
