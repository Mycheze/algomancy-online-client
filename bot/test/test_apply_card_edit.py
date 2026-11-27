#!/usr/bin/env python3
"""test_apply_card_edit.py — the card editor's apply job, on synthetic cards.

Real scans are copied into a scratch tree and drawn on; nothing under data/ is written.
The picture checks, the oracle edit, the scan, the update line and the classifier bridge
are run against that tree; the readers, extract and the corpus are the repo's own tools
and are not run here.

Run: python3 test_apply_card_edit.py
"""

# ── reaching the bot package ──────────────────────────────────────────
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent / "pipeline"))
import _scratch_var  # noqa: F401,E402
# ──────────────────────────────────────────────────────────────────────

import contextlib
import io
import json
import shutil
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import paths
import apply_card_edit as job

fails = []


def check(label, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {label}")
    if not cond:
        print(f"        {detail}")
        fails.append(label)


SCRATCH = Path(tempfile.mkdtemp(prefix="algo-apply-edit-"))
REAL = job.Tree(paths.REPO_ROOT)
TREE = job.Tree(SCRATCH)


def build_tree():
    """A scratch clone holding only what the checks read, plus the classifier bridge."""
    for name in ("ORACLE_JSON", "CARD_FACES", "TEXT_BOXES", "UPDATES_TS", "CARD_EDIT_CLI"):
        dest = getattr(TREE, name)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(getattr(REAL, name), dest)
    # the bridge imports the classifier by its relative path
    ui = TREE.CLIENT_DIR / "ui"
    shutil.copy(REAL.CLIENT_DIR / "ui" / "cardnotation.ts", ui / "cardnotation.ts")
    for card in ("Murkstalker", "Angel of Anguish", "A Pile of Runes"):
        shutil.copy(REAL.scan(card), TREE.scan(card))


build_tree()
PICS = SCRATCH / "pics"
PICS.mkdir()
FONT = ImageFont.load_default(size=44)
SMALL = ImageFont.load_default(size=22)


def save(im, name, quality=95):
    p = PICS / name
    im.save(p, quality=quality)
    return p


def scan_of(card):
    return Image.open(TREE.scan(card)).convert("RGB")


def new_numeral(im, text="3"):
    """the cost orb repainted with another numeral, pips untouched"""
    im = im.copy()
    d = ImageDraw.Draw(im)
    d.ellipse((75 - 26, 72 - 26, 75 + 26, 72 + 26), fill=(12, 12, 12))
    d.text((75, 72), text, fill=(250, 250, 250), font=FONT, anchor="mm")
    return im


def new_words(im, xy=(90, 895), text="and draw a card"):
    im = im.copy()
    ImageDraw.Draw(im).text(xy, text, fill=(20, 20, 20), font=SMALL)
    return im


def edit_file(name, card, after, diff, road="fast", posted=None):
    cmds = [{"text": t, "field": f, "reply": None,
             "posted": {"messageId": "m1", "channelId": "c1", "content": t if posted is None else posted,
                        "at": "2026-11-27T18:03:00Z"}}
            for f, t in (("total cost", f"$modify {card.lower()}|total cost|{after.get('total_cost')}"),)
            if "total_cost" in after]
    row = json.loads(TREE.ORACLE_JSON.read_text(encoding="utf-8"))[card][0]
    edit = {"v": 1, "id": f"ce-20261127-test-{name}", "card": card, "by": {"name": "Caleb"},
            "createdAt": "2026-11-27T18:02:11Z", "base": {"rowHash": "x", "row": row},
            "edit": {}, "after": after, "diff": diff, "road": road, "why": [], "commands": cmds,
            "events": []}
    p = SCRATCH / f"{name}.json"
    p.write_text(json.dumps(edit), encoding="utf-8")
    return p


def run_main(*argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = job.main([*map(str, argv), "--repo", str(SCRATCH)])
    try:
        return code, json.loads(out.getvalue() or "{}")
    except json.JSONDecodeError:
        return code, {"raw": out.getvalue()}


def steward(card, fields, before, after):
    try:
        job.check_pictures(TREE, card, fields, before, after)
    except job.ToSteward as e:
        return e
    return None


print("--- the picture checks ---")
murk = scan_of("Murkstalker")
before = save(murk, "murk-before.jpg")
after = save(new_numeral(murk), "murk-after.jpg")
ok = steward("Murkstalker", ["total_cost"], before, after)
check("a numbers-only change passes", ok is None, ok and (ok.why, ok.measurements))

reencoded = save(murk, "murk-before-q92.jpg", quality=92)
ok = steward("Murkstalker", ["total_cost"], reencoded, save(new_numeral(murk), "a2.jpg", 92))
check("JPEG noise in a re-encoded picture is not drift", ok is None, ok and ok.measurements)

drifted = save(new_words(murk), "murk-drifted.jpg")
e = steward("Murkstalker", ["total_cost"], drifted, save(new_numeral(new_words(murk)), "a3.jpg"))
check("drift: a before picture with other words is refused",
      e is not None and e.measurements.get("check") == "drift" and "text box" in e.why,
      e and (e.why, e.measurements))

e = steward("Murkstalker", ["total_cost"], before,
            save(new_numeral(new_words(murk, (300, 905), "3")), "a4.jpg"))
check("a text-box change smuggled into a numbers edit is refused",
      e is not None and e.measurements.get("check") == "regions" and "text box" in e.why,
      e and (e.why, e.measurements))

e = steward("Murkstalker", ["power"], before, after)
check("a cost change sent as a power edit is refused (the orb is not the stat box)",
      e is not None, e and e.measurements)

e = steward("Murkstalker", ["total_cost"], before, before)
check("a new picture that shows no change is refused",
      e is not None and e.measurements.get("check") == "shows", e and (e.why, e.measurements))

angel = scan_of("Angel of Anguish")
e = steward("Angel of Anguish", ["total_cost"], save(angel, "angel-b.jpg"),
            save(new_numeral(angel), "angel-a.jpg"))
check("a banner card goes to the steward", e is not None and "banner" in e.why,
      e and (e.why, e.measurements))

print("\n--- the scan ---")
narrow_before = murk.resize((719, 1000))
narrow_after = new_numeral(murk).resize((719, 1000))
nb, na = save(narrow_before, "n-before.jpg"), save(narrow_after, "n-after.jpg")
job.write_scan(nb, TREE.scan("Murkstalker"))          # an earlier landing of a 719-wide render
ok = steward("Murkstalker", ["total_cost"], nb, na)
check("a 719-wide pair passes against the scan it landed as", ok is None, ok and ok.measurements)
out = SCRATCH / "out.jpg"
job.write_scan(na, out)
with Image.open(out) as im:
    check("a 719-wide render comes out 720x1000 RGB", im.size == (720, 1000) and im.mode == "RGB",
          (im.size, im.mode))
shutil.copy(REAL.scan("Murkstalker"), TREE.scan("Murkstalker"))

print("\n--- the classifier bridge and the steward road ---")
murk_row = json.loads(TREE.ORACLE_JSON.read_text(encoding="utf-8"))["Murkstalker"][0]
up = str(int(murk_row["total_cost"]) + 1)
v = job.classify(TREE, edit_file("murk", "Murkstalker", {"total_cost": up},
                                 [{"field": "total_cost", "from": murk_row["total_cost"], "to": up}]))
check("the bridge: a cost change is fast, with its update line",
      v["road"] == "fast" and not v["problems"] and v["updateLine"] == f"Murkstalker now costs {up} (was {murk_row['total_cost']}).",
      v)

runes = edit_file("runes", "A Pile of Runes", {"cost": "bg"}, None)
code, said = run_main(runes, before, after)
check("an underivable Deck exits 3 with its reason",
      code == 3 and "deck" in said.get("why", "") and said.get("touched") == [], (code, said))

code, said = run_main(edit_file("drift", "Murkstalker", {"total_cost": up}, None),
                      drifted, save(new_numeral(new_words(murk)), "a5.jpg"))
check("drift exits 3 with a sentence and the measurement",
      code == 3 and said.get("why", "").endswith(".") and said["measurements"].get("tile", 0) > job.DRIFT_TILE,
      (code, said))

code, said = run_main(edit_file("posted", "Murkstalker", {"total_cost": up}, None,
                                posted="$modify murkstalker|total cost|9"), before, after)
check("a posted value other than the edit's exits 3", code == 3 and "the posted total_cost is 9" in said.get("why", "").lower(),
      (code, said))

code, said = run_main(edit_file("road", "Murkstalker", {"text": "x"}, None, road="steward"), before, after)
check("an edit on the steward's road exits 3 untouched", code == 3 and said.get("touched") == [],
      (code, said))

print("\n--- the oracle row, in place ---")
raw = REAL.ORACLE_JSON.read_text(encoding="utf-8")
v = job.classify(TREE, edit_file("aff", "Murkstalker", {"cost": "lb"}, None))
values = {d["field"]: d["to"] for d in v["diff"]}
check("an affinity change carries factions and Deck",
      values == {"cost": "lb", "factions": ["light", "water"], "Deck": "Light & Dark (Light/Water)"},
      v["diff"])
values["revision_date_time"] = job.revision_stamp("2026-11-27T18:02:11Z")
new = job.set_row_fields(raw, "Murkstalker", values)
old_lines, new_lines = raw.split("\n"), new.split("\n")
changed = [x for a, b in zip(old_lines, new_lines) if a != b for x in ("-" + a, "+" + b)]
want = {'-            "cost": "ld",', '+            "cost": "lb",',
        '-                "dark"', '+                "water"',
        '-            "Deck": "Light & Dark (Light/Dark)",', '+            "Deck": "Light & Dark (Light/Water)",',
        '-            "revision_date_time": "2026-11-06 00:00:00.000000",',
        '+            "revision_date_time": "2026-11-27 00:00:00.000000",'}
check("the oracle edit touches only the changed fields' lines",
      len(old_lines) == len(new_lines) and set(changed) == want and len(changed) == len(want),
      "\n".join(changed))
check("everything outside the row is byte for byte", new.split('"Murkstalker": [')[0] == raw.split('"Murkstalker": [')[0]
      and new.split('"Murkstalker": [')[1].split("\n    ],", 1)[1] == raw.split('"Murkstalker": [')[1].split("\n    ],", 1)[1])
new2 = job.set_row_fields(raw, "Murkstalker", {"total_cost": "3"})
check("a numbers change is one line", sum(1 for a, b in zip(raw.split("\n"), new2.split("\n")) if a != b) == 1)
try:
    job.set_row_fields(raw, "Murkstalker", {"nonsense": "1"})
    check("a field the row lacks goes to the steward", False)
except job.ToSteward as e:
    check("a field the row lacks goes to the steward", "nonsense" in e.why)

print("\n--- the update line ---")
src = REAL.UPDATES_TS.read_text(encoding="utf-8")
newest = job.ENTRY.findall(src.split(job.UPDATES_HEAD, 1)[1])[0][0]
text = "Blight's End now costs 4 (was 3)."
out = job.add_update_line(src, newest, text)
top = job.ENTRY.findall(out.split(job.UPDATES_HEAD, 1)[1])[0]
check("the line goes at the top of UPDATES, its apostrophe escaped",
      top == (newest, "Blight\\'s End now costs 4 (was 3).") and out.count("\n") == src.count("\n") + 1, top)
check("323's rules hold: length, no ids, no markup, newest first",
      20 <= len(text) <= 240 and not job.INTERNAL_ID.search(text) and top[0] >= newest)
for bad, why in (("Murkstalker now costs 2 (CT-12).", "id"), ("x" * 241, "long"), ("Short.", "short")):
    try:
        job.add_update_line(src, newest, bad)
        check(f"an update line that is too {why} is refused", False)
    except job.ToSteward:
        check(f"an update line with an {why} is refused" if why == "id" else f"a too {why} line is refused", True)
try:
    job.add_update_line(out, newest, text)
    check("the same line twice is refused", False)
except job.ToSteward:
    check("the same line twice is refused", True)
msg = job.commit_message({"id": "ce-x", "card": "Murkstalker", "by": {"name": "Caleb"},
                          "createdAt": "2026-11-27T00:00:00Z"},
                         {"diff": [{"field": "total_cost", "from": "2", "to": "3"}]}, "Murkstalker now costs 3 (was 2).")
check("the commit message ends with its Card-Edit trailer", msg.rstrip().endswith("\n\nCard-Edit: ce-x"), msg)

print("\n--- the follow-ups (read only, the real tree) ---")
hits = job.followups(REAL, "Murkstalker")
check("prose naming the card is found and located",
      all({"file", "line", "text"} <= set(h) for h in hits) and all("Murkstalker" in h["text"] for h in hits),
      hits[:3])

shutil.rmtree(SCRATCH, ignore_errors=True)
print()
if fails:
    print(f"{len(fails)} FAILED: " + ", ".join(fails))
    sys.exit(1)
print("all good")
