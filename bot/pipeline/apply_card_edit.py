#!/usr/bin/env python3
"""apply_card_edit.py — land one fast-path card edit in the clone it runs in.

    .venv/bin/python bot/pipeline/apply_card_edit.py <edit.json> <before.jpg> <after.jpg> [--repo <root>]

The steward runner calls it on a fresh branch, one edit at a time (client/docs/card-editor.md
§6). It never commits, pushes or runs the gate: the runner does. It edits the tree:

  1. the picture checks: not a banner card; FriendlyBot's "before" picture is our scan (drift);
     "after" differs from "before" only where the changed fields print (regions);
  2. the oracle row, in place, only the changed fields (+ factions/Deck, revision_date_time);
  3. the scan: "after", RGB, 720x1000, quality 92;
  4. the four scan readers in the card-update recipe's order, then this card's face report;
  5. npm run extract;  6. the card's face comment;  7. the corpus;  8. the update line;
  9. the prose that names the card, returned as follow-ups.

Exit 0: applied; stdout is a JSON summary (the update line, the commit message with its
`Card-Edit:` trailer, the follow-ups). Exit 3: the edit goes to the steward; stdout is
{"why": one sentence a player can read, "measurements": …, "touched": the files already
changed, which the runner discards}. Exit 2: an input the job needs is missing, nothing was
touched. Anything else is a crash.
"""

# ── reaching the bot package ──────────────────────────────────────────
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
# ──────────────────────────────────────────────────────────────────────

import argparse
import datetime
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

import paths

EXIT_APPLIED, EXIT_MISSING, EXIT_STEWARD = 0, 2, 3

# ── the frame ─────────────────────────────────────────────────────────
# FriendlyBot draws every card on one 720x1000 frame (read_card_faces.py measures the same
# one); boxes are (x0, y0, x1, y1), half-open.
SCAN_SIZE = (720, 1000)
#: the cost orb: numeral, disc and the three pip slots, with the slack a second digit takes
ORB_BOX = (20, 20, 140, 140)
#: power/toughness at the title bar's right end, left of where a timing glyph sits
STATS_BOX = (470, 38, 705, 110)
#: a Prophecy/Ambush plate hangs here, under the title bar; the renders never carry it
BANNER_STRIP = (0, 95, 420, 160)
#: the rounded corners and the outer edge: the renderer's anti-aliasing moves here alone
BORDER = 16
#: the text box ends on this row on every frame (its outline is at 946-948 on 389 scans)
TEXT_BOTTOM = 940
#: the type bar's height below textTop, and the text box's inner left and right
TYPE_BAR_H = 48
TEXT_X = (62, 658)

# ── the thresholds, and what they were measured on ────────────────────
#: a grey step past JPEG noise: a scan re-encoded at quality 92 moves no pixel of the
#: card's face by more than 24 against FriendlyBot's original (328 such pairs measured)
GREY_STEP = 24
#: the unit a difference is judged in: 20 rows x 16 columns (one glyph of body text)
TILE = (20, 16)
#: DRIFT: a tile with more than this share of changed pixels is a different card. Over 513
#: render/scan pairs, renderer-only changes (a frame line 1 px over, a sub-pixel shift of a
#: name) reach 0.203; a single changed digit of body text measures 0.287, a typo fix 0.263,
#: a cost numeral 0.431. A share of the whole card cannot see these: they move 0.06-0.5%.
DRIFT_TILE = 0.20
#: STRAY: before and after are one renderer's pictures seconds apart. Outside the field that
#: changed they are equal to within JPEG noise (a real cost-only pair: no pixel past 24
#: outside the orb), so a few changed pixels in one tile is already a change.
STRAY_TILE = 0.02
#: a changed field must show: its box holds at least one tile this changed
SHOWS_TILE = 0.20
#: ART: a new picture shows through every translucent bar, so for an art change the text is
#: compared as glyph masks (1 px of slack). Art-only pairs reach 0.125, an added reminder
#: sentence 0.156: the narrowest margin here, which is why art is checked this way at all.
GLYPH_TILE = 0.14

#: the fields whose region on the face may change, by oracle field
FIELD_BOX = {"total_cost": ORB_BOX, "cost": ORB_BOX, "power": STATS_BOX, "toughness": STATS_BOX}
#: fields that follow another field and print nothing of their own
SILENT_FIELDS = {"factions", "Deck"}
FIELD_WORDS = {"total_cost": "cost", "cost": "affinity", "power": "power",
               "toughness": "toughness", "image": "art"}

#: the scan readers, in the card-update recipe's order (steward/SKILL.md §14 step 4)
SCAN_READERS = ("build_anchors.py", "classify_complexity.py", "read_text_boxes.py",
                "read_card_faces.py")


class ToSteward(Exception):
    """The edit cannot land by itself: `why` is the sentence the editor's status shows."""

    def __init__(self, why, **measurements):
        super().__init__(why)
        self.why = why
        self.measurements = measurements


class Missing(Exception):
    """An input the job needs is not in this clone."""


# ── where things are, in the clone the job runs in ────────────────────

class Tree:
    """paths.py's names, re-rooted at `root`."""

    def __init__(self, root):
        self.root = Path(root).resolve()

    def __getattr__(self, name):
        p = getattr(paths, name)
        return self.root / Path(p).relative_to(paths.REPO_ROOT)

    def scan(self, card):
        """the scan's file name, as extract-printed.mjs spells it"""
        return self.CARDS_DIR / (card.replace(" ", "-") + ".jpg")

    def rel(self, p):
        return str(Path(p).resolve().relative_to(self.root))


# ── the pictures ──────────────────────────────────────────────────────

def card_picture(path):
    """A picture as the job compares and stores it: RGB, 720x1000 (renders come 719 or 735 wide)."""
    im = Image.open(path).convert("RGB")
    return im if im.size == SCAN_SIZE else im.resize(SCAN_SIZE)


def write_scan(src, dest):
    """Step 3: the new picture as a scan (steward/SKILL.md §14 step 1). A scan of any other
    size is skipped silently by read_card_faces.py, so the size is asserted here."""
    card_picture(src).save(dest, quality=92)
    with Image.open(dest) as im:
        if im.size != SCAN_SIZE or im.mode != "RGB":
            raise RuntimeError(f"{dest} came out {im.size} {im.mode}")


def grey(im):
    return np.asarray(im.convert("L"), dtype=np.int16)


def blank(mask, box):
    x0, y0, x1, y1 = box
    mask[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = False


def tiles(mask):
    """the share of set pixels in each TILE of a full-frame mask"""
    th, tw = TILE
    h, w = mask.shape
    return mask[:h // th * th, :w // tw * tw].reshape(h // th, th, w // tw, tw).mean(axis=(1, 3))


def worst_tile(mask):
    """(share, x, y) of the most-changed tile"""
    t = tiles(mask)
    ty, tx = np.unravel_index(int(t.argmax()), t.shape)
    return float(t[ty, tx]), int(tx * TILE[1]), int(ty * TILE[0])


def changed(a, b):
    """pixels more than GREY_STEP apart, the outer border left out"""
    m = np.abs(a - b) > GREY_STEP
    m[:BORDER] = m[-BORDER:] = False
    m[:, :BORDER] = m[:, -BORDER:] = False
    return m


def where_on_card(x, y, text_top):
    if y < 110:
        return "the cost orb" if x < ORB_BOX[2] else "the title bar"
    if y >= text_top + TYPE_BAR_H:
        return "the text box"
    if y >= text_top:
        return "the type line"
    return "the art"


def text_regions(text_top):
    """where words print, as (name, box): the cost numeral, the name, the type line, the rules"""
    return (("the cost orb", (45, 45, 110, 100)),
            ("the title bar", (135, 48, 600, 100)),
            ("the type line", (TEXT_X[0], text_top + 4, 600, text_top + TYPE_BAR_H - 4)),
            ("the text box", (TEXT_X[0], text_top + TYPE_BAR_H, TEXT_X[1], TEXT_BOTTOM)))


def glyph_mask(g, box, ref):
    """the box's lettering: dark glyphs on a light bar, light ones on a dark bar (`ref` decides)"""
    x0, y0, x1, y1 = box
    r = g[y0:y1, x0:x1]
    return (r < 70) if np.median(ref[y0:y1, x0:x1]) > 128 else (r > 190)


def grow(m):
    """the mask, one pixel wider every way"""
    p = np.pad(m, 1)
    out = np.zeros_like(m)
    for dy in range(3):
        for dx in range(3):
            out |= p[dy:dy + m.shape[0], dx:dx + m.shape[1]]
    return out


def glyphs_moved(a, b, text_top):
    """(share, region) of the worst tile where the lettering differs, 1 px of slack"""
    worst = (0.0, None)
    for name, box in text_regions(text_top):
        ma, mb = glyph_mask(a, box, a), glyph_mask(b, box, a)
        x = (ma & ~grow(mb)) | (mb & ~grow(ma))
        if x.shape[0] >= TILE[0] and x.shape[1] >= TILE[1]:
            share = float(tiles(x).max())
            if share > worst[0]:
                worst = (share, name)
    return worst


def check_pictures(tree, card, fields, before_path, after_path):
    """Step 1. `fields` are the oracle fields the edit changes. Raises ToSteward."""
    faces = json.loads(tree.CARD_FACES.read_text(encoding="utf-8")).get("cards", {})
    face = faces.get(card)
    if face is None:
        raise ToSteward(f"{card} has no scan the readers could read, so FriendlyBot's picture "
                        f"can't be checked against it.", card_faces="absent")
    if face.get("alt"):
        raise ToSteward(f"{card} carries a hand-drawn Prophecy or Ambush banner that FriendlyBot's "
                        f"pictures leave out.", banner_pips=face["alt"].get("pips"))
    boxes = json.loads(tree.TEXT_BOXES.read_text(encoding="utf-8"))
    if card not in boxes:
        raise ToSteward(f"{card}'s type line could not be found on its scan, so the regions "
                        f"of its picture can't be told apart.", text_top="absent")
    text_top = int(boxes[card]["top"])
    scan_path = tree.scan(card)
    if not scan_path.exists():
        raise ToSteward(f"{card} has no scan to compare FriendlyBot's picture with.", scan="absent")

    scan, before, after = (grey(card_picture(p)) for p in (scan_path, before_path, after_path))

    drift = changed(scan, before)
    blank(drift, BANNER_STRIP)
    share, x, y = worst_tile(drift)
    if share > DRIFT_TILE:
        raise ToSteward(f"FriendlyBot's picture of {card} before this change already differs from "
                        f"ours in {where_on_card(x, y, text_top)}, so his card and ours had parted.",
                        check="drift", tile=round(share, 3), threshold=DRIFT_TILE, x=x, y=y)
    measured = {"drift_tile": round(share, 3)}

    diff = changed(before, after)
    shown = [f for f in fields if f not in SILENT_FIELDS]
    for f in shown:
        box = (0, 0, SCAN_SIZE[0], text_top) if f == "image" else FIELD_BOX[f]
        inside = np.zeros_like(diff)
        x0, y0, x1, y1 = box
        inside[y0:y1, x0:x1] = diff[y0:y1, x0:x1]
        if worst_tile(inside)[0] <= SHOWS_TILE:
            raise ToSteward(f"FriendlyBot's new picture of {card} does not show the new "
                            f"{FIELD_WORDS.get(f, f)}.", check="shows", field=f)
    if "image" in shown:
        share, region = glyphs_moved(before, after, text_top)
        if share > GLYPH_TILE:
            raise ToSteward(f"FriendlyBot's new picture of {card} changed {region} as well as "
                            f"the art.", check="regions", glyph_tile=round(share, 3),
                            threshold=GLYPH_TILE, where=region)
        measured["glyph_tile"] = round(share, 3)
    else:
        stray = diff.copy()
        for f in shown:
            blank(stray, FIELD_BOX[f])
        share, x, y = worst_tile(stray)
        if share > STRAY_TILE:
            raise ToSteward(f"FriendlyBot's new picture of {card} changed "
                            f"{where_on_card(x, y, text_top)} too, which this edit does not touch.",
                            check="regions", tile=round(share, 3), threshold=STRAY_TILE, x=x, y=y)
        measured["stray_tile"] = round(share, 3)
    measured["text_top"] = text_top
    return measured


# ── the oracle row, in place ──────────────────────────────────────────

ROW_INDENT = " " * 12


def set_row_fields(raw, card, values):
    """`raw` (the oracle file's text) with `values` written into `card`'s row, every other byte
    kept. The file mixes escaped and literal non-ASCII, so it is never re-serialized whole."""
    lines = raw.split("\n")
    heads = {f"    {json.dumps(card, ensure_ascii=a)}: [" for a in (False, True)}
    start = next((i for i, ln in enumerate(lines) if ln in heads), None)
    if start is None:
        raise ToSteward(f"{card} is not in the oracle file.", oracle="absent")
    end = next(i for i in range(start + 1, len(lines)) if lines[i] in ("    ]", "    ],"))
    for field, value in values.items():
        lead = f"{ROW_INDENT}{json.dumps(field)}: "
        i = next((k for k in range(start, end) if lines[k].startswith(lead)), None)
        if i is None:
            raise ToSteward(f"{card}'s row has no {field} to change.", field=field)
        j = i + 1
        while j < end and not (lines[j].startswith(ROW_INDENT + '"') or lines[j] == "        }"):
            j += 1
        old = lines[i:j]
        body = json.dumps(value, indent=4, ensure_ascii="\\u" in "".join(old)).split("\n")
        new = [lead + body[0]] + [ROW_INDENT + ln for ln in body[1:]]
        if old[-1].endswith(","):
            new[-1] += ","
        lines[i:j] = new
        end += len(new) - len(old)
    out = "\n".join(lines)
    want = json.loads(raw)
    want[card][0].update(values)
    got = json.loads(out)
    if got != want or list(got[card][0]) != list(want[card][0]):
        raise RuntimeError(f"the oracle edit for {card} did not round-trip")
    return out


def revision_stamp(created_at):
    """the house format of revision_date_time, for the day the edit was made"""
    day = datetime.date.fromisoformat(str(created_at)[:10])
    return f"{day.isoformat()} 00:00:00.000000"


# ── the update line ───────────────────────────────────────────────────

#: client/ui/test/323-recent-updates.test.ts's rules, so a line that would fail it never lands
MAX_UPDATE_CHARS = 240
INTERNAL_ID = re.compile(r"\b(?:R\d{2,}|CR \d{3}|CR D\d|BL-\d+|CT-\d+)\b|#\d{2,}\b")
UPDATES_HEAD = "export const UPDATES: readonly Update[] = [\n"
ENTRY = re.compile(r"^  \{ date: '(\d{4}-\d{2}-\d{2})', kind: '\w+', text: '((?:[^'\\]|\\.)*)' \},$",
                   re.M)


def opening(text):
    """the first sentence, lower-cased (323 §7: two lines opening alike say the same thing)"""
    return re.split(r"(?<=[.!?])\s", text)[0].strip().lower()


def ts_string(text):
    return text.replace("\\", "\\\\").replace("'", "\\'")


def add_update_line(src, day, text):
    """updates.ts with `text` as the newest entry; ToSteward when 323 would reject it."""
    if UPDATES_HEAD not in src:
        raise RuntimeError("updates.ts has no UPDATES array")
    if not (20 <= len(text.strip()) and len(text) <= MAX_UPDATE_CHARS):
        raise ToSteward("The update line for this edit is too long or too short.", line=text)
    if INTERNAL_ID.search(text) or re.search(r"<[a-z/]", text, re.I):
        raise ToSteward("The update line for this edit would show an id or markup.", line=text)
    entries = ENTRY.findall(src.split(UPDATES_HEAD, 1)[1])
    if entries and entries[0][0] > day:
        raise ToSteward("The newest update line is dated after today.", newest=entries[0][0], today=day)
    said = {opening(t.replace("\\'", "'")) for _, t in entries}
    if opening(text) in said:
        raise ToSteward("The home page already has this exact update line.", line=text)
    entry = f"  {{ date: '{day}', kind: 'change', text: '{ts_string(text)}' }},\n"
    return src.replace(UPDATES_HEAD, UPDATES_HEAD + entry, 1)


# ── the prose that names the card ─────────────────────────────────────

def followups(tree, card):
    """Every line of the hand-written prose that names `card`: the runner files them."""
    files = [*sorted(tree.CR_RECORDS_DIR.glob("*.json")), tree.LESSONS_TS,
             *sorted(tree.SCENARIOS_DIR.glob("scenarios-*.ts")), tree.GENERATED_RULINGS,
             tree.EVAL_GOLD, tree.DOES_LINES, tree.LD_TRANSCRIPTION_NOTES]
    name = re.compile(rf"(?<![\w'-]){re.escape(card)}(?![\w'-])")
    hits = []
    for f in files:
        if not f.exists():
            continue
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if name.search(line):
                hits.append({"file": tree.rel(f), "line": n, "text": line.strip()[:200]})
    return hits


# ── the steps that run the repo's own tools ───────────────────────────

def run(tree, argv, step, timings):
    """Run one tool in the clone; a failure sends the edit to the steward with its tail."""
    t0 = time.monotonic()
    proc = subprocess.run(argv, cwd=tree.root, capture_output=True, text=True)
    timings[step] = round(time.monotonic() - t0, 1)
    print(f"[apply_card_edit] {step}: exit {proc.returncode} in {timings[step]} s", file=sys.stderr)
    if proc.returncode != 0:
        tail = (proc.stdout + proc.stderr).strip().splitlines()[-12:]
        raise ToSteward(f"The {step} step failed on the changed card.", step=step,
                        exit=proc.returncode, tail=tail)
    return proc.stdout


def preflight(tree, python):
    """Everything the job needs, checked before it touches a file."""
    need = [tree.ORACLE_JSON, tree.CARD_FACES, tree.TEXT_BOXES, tree.COMPLEXITY_OVERRIDES,
            tree.UPDATES_TS, tree.CARD_EDIT_CLI, tree.ENGINE_DIR / "package.json",
            *(tree.PIPELINE_DIR / r for r in SCAN_READERS), tree.PIPELINE_DIR / "build_corpus.py"]
    gone = [tree.rel(p) for p in need if not p.exists()]
    if gone:
        raise Missing(f"missing from the clone: {', '.join(gone)}")
    # build_rulings refuses an empty export too, but only after the scan and the oracle are
    # written; a corpus built without it would drop every thread's rulings
    if not any(tree.RULINGS_EXPORTS.glob("*.json")):
        raise Missing(f"the rulings export is not in {tree.rel(tree.RULINGS_EXPORTS)} "
                      f"(steward/review.sh sync-rulings puts it there)")
    probe = subprocess.run([python, "-c", "import fitz"], capture_output=True)
    if probe.returncode != 0:
        raise Missing("PyMuPDF is not installed: build_corpus.py would fall back to pdftotext "
                      "and change the corpus's chunks (pip install -r bot/pipeline/requirements.txt)")
    for tool in ("node", "npm"):
        if shutil.which(tool) is None:
            raise Missing(f"{tool} is not on PATH")


def classify(tree, edit_path):
    """client/ui/cardnotation.ts's verdict on the edit against the current row."""
    proc = subprocess.run(["node", str(tree.CARD_EDIT_CLI), str(edit_path), str(tree.ORACLE_JSON)],
                          cwd=tree.root, capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


def commit_message(edit, verdict, text):
    who = (edit.get("by") or {}).get("name") or "The designer"
    day = str(edit.get("createdAt", ""))[:10]
    fields = ", ".join(f"{d['field']} {json.dumps(d['from'])} → {json.dumps(d['to'])}"
                       for d in verdict["diff"])
    return (f"Card edit: {text}\n\n"
            f"{who} changed {edit['card']} with FriendlyBot on {day}, through the card editor:\n"
            f"{fields}. FriendlyBot's new picture is the scan; the four scan readers, extract,\n"
            f"the face comment, the corpus and the update line follow it.\n\n"
            f"Card-Edit: {edit['id']}\n")


# ── the job ───────────────────────────────────────────────────────────

def apply(tree, edit_path, before, after, python=sys.executable, today=None, touched=None):
    """Steps 1-9. Returns the summary; raises ToSteward or Missing. `touched` collects the
    files written, so a refusal can name them."""
    touched = [] if touched is None else touched
    timings = {}
    edit = json.loads(Path(edit_path).read_text(encoding="utf-8"))
    card = edit["card"]
    if edit.get("road") != "fast":
        raise ToSteward("; ".join(edit.get("why") or []) or "This edit takes the steward's road.",
                        road=edit.get("road"))

    verdict = classify(tree, edit_path)
    if verdict["road"] != "fast":
        raise ToSteward(f"{card}: {'; '.join(verdict['why'])}.", road="steward", reasons=verdict["why"])
    if verdict["problems"]:
        raise ToSteward(f"{verdict['problems'][0][0].upper()}{verdict['problems'][0][1:]}.",
                        problems=verdict["problems"])
    if edit.get("diff") is not None and edit["diff"] != verdict["diff"]:
        raise ToSteward(f"{card} no longer matches the change this edit recorded.",
                        recorded=edit["diff"], now=verdict["diff"])
    fields = [d["field"] for d in verdict["diff"]]

    t0 = time.monotonic()
    measured = check_pictures(tree, card, fields, before, after)
    timings["pictures"] = round(time.monotonic() - t0, 1)
    preflight(tree, python)

    values = {d["field"]: d["to"] for d in verdict["diff"]}
    values["revision_date_time"] = revision_stamp(edit["createdAt"])
    raw = tree.ORACLE_JSON.read_text(encoding="utf-8")
    tree.ORACLE_JSON.write_text(set_row_fields(raw, card, values), encoding="utf-8")
    touched.append(tree.rel(tree.ORACLE_JSON))

    write_scan(after, tree.scan(card))
    touched.append(tree.rel(tree.scan(card)))

    overrides_before = json.loads(tree.COMPLEXITY_OVERRIDES.read_text(encoding="utf-8"))
    boxes_before = json.loads(tree.TEXT_BOXES.read_text(encoding="utf-8"))
    touched += [tree.rel(p) for p in (tree.MOD_ANCHORS, tree.COMPLEXITY_OVERRIDES, tree.TEXT_BOXES,
                                      tree.CARD_FACES, tree.SCAN_READS)]
    for reader in SCAN_READERS:
        run(tree, [python, str(tree.PIPELINE_DIR / reader)], reader[:-3], timings)
    # read_card_faces.py --report reads exactly what the run above wrote: its `disagrees`
    face = json.loads(tree.CARD_FACES.read_text(encoding="utf-8"))["cards"].get(card)
    if face is None:
        raise ToSteward(f"The scan readers could not read {card}'s new picture.", card_faces="absent")
    if face["disagrees"]:
        d = face["disagrees"][0]
        raise ToSteward(f"{card}'s new picture disagrees with its row: {d['detail']}.",
                        disagrees=face["disagrees"])
    over_now = json.loads(tree.COMPLEXITY_OVERRIDES.read_text(encoding="utf-8"))
    was, now = ((o.get("cards", o).get(card) or {}).get("to") for o in (overrides_before, over_now))
    if was != now:
        raise ToSteward(f"{card}'s new picture reads as {now or 'no'} complexity, not {was or 'none'}.",
                        check="stray", complexity=[was, now])
    tops = [(b.get(card) or {}).get("top") for b in
            (boxes_before, json.loads(tree.TEXT_BOXES.read_text(encoding="utf-8")))]
    if tops[0] != tops[1]:
        raise ToSteward(f"{card}'s rules box moved on the new picture, which a change of numbers "
                        f"does not do.", check="stray", text_top=tops)

    touched += [tree.rel(tree.PRINTED_JSON), tree.rel(tree.ENGINE_DIR / "src" / "cards" / "catalogue.json")]
    run(tree, ["npm", "--prefix", str(tree.ENGINE_DIR), "run", "--silent", "extract"], "extract", timings)

    face_note = "face-comment.mjs is not in this clone; the face comment was left alone"
    if tree.FACE_COMMENT_MJS.exists():
        face_note = run(tree, ["node", str(tree.FACE_COMMENT_MJS), "--rewrite", card],
                        "face-comment", timings).strip()
        rewrote = re.search(r"rewritten .*\(([^()]+\.ts)\)$", face_note)
        if rewrote:
            touched.append(rewrote.group(1))

    touched.append(tree.rel(tree.CORPUS))
    run(tree, [python, str(tree.PIPELINE_DIR / "build_corpus.py")], "corpus", timings)

    day = today or datetime.date.today().isoformat()
    text = verdict["updateLine"]
    tree.UPDATES_TS.write_text(add_update_line(tree.UPDATES_TS.read_text(encoding="utf-8"), day, text),
                               encoding="utf-8")
    touched.append(tree.rel(tree.UPDATES_TS))

    return {"id": edit["id"], "card": card, "diff": verdict["diff"],
            "update": {"date": day, "kind": "change", "text": text},
            "commitMessage": commit_message(edit, verdict, text),
            "followups": followups(tree, card), "faceComment": face_note,
            "measurements": measured, "timings": timings, "touched": sorted(set(touched))}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("edit")
    ap.add_argument("before")
    ap.add_argument("after")
    ap.add_argument("--repo", default=str(paths.REPO_ROOT), help="the clone to edit")
    args = ap.parse_args(argv)
    tree, touched = Tree(args.repo), []
    try:
        summary = apply(tree, args.edit, args.before, args.after, touched=touched)
    except ToSteward as e:
        print(json.dumps({"why": e.why, "measurements": e.measurements,
                          "touched": sorted(set(touched))}, ensure_ascii=False))
        return EXIT_STEWARD
    except Missing as e:
        print(f"apply_card_edit: {e}", file=sys.stderr)
        return EXIT_MISSING
    print(json.dumps(summary, ensure_ascii=False))
    return EXIT_APPLIED


if __name__ == "__main__":
    sys.exit(main())
