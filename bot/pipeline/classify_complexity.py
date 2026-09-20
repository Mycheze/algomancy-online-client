#!/usr/bin/env python3
"""classify_complexity.py — read each card's complexity off the icon on its scan.

Build-time only. Writes data/cards/complexity-overrides.json, which the client's
`npm run extract` (client/engine/scripts/extract-printed.mjs) applies to the
oracle file's `complexity` field on the way into catalogue.json.

WHY. The oracle transcription carries a real complexity for the base game
(`Simple` / `Complex`, plus `Glitch` for the Kickstarter cards) but the Light &
Dark rows were entered as `Common` — a value the printed cards do not have.
Owner, 2026-09-05: "The rarity of Light v Dark cards is all wrong. They're all in
there as 'Common' right now. The icons used for simple/complex are 100%
consistent, so it should be fairly easy for you to script something that finds
the icon, then recognizes the color of the icon to set it to either simple or
complex."

WHAT THE ICON IS. Every card prints a small diamond glyph at the right-hand end
of its type bar (the bar above the rules text): x is fixed at ~613-657 on the
720x1000 scans, y follows the text box, anywhere from ~740 to ~910. A SILVER
glyph is Simple, a GOLD one is Complex. The glyph has the same shape and the
same dark outline in both colours, so:

  1. LOCATE it with a normalised cross-correlation of a luminance template
     (cut from one silver icon) down the fixed-x band — the same technique
     build_anchors.py uses for the augment glyph;
  2. CLASSIFY by colour inside the located glyph: mean (R - B) over the
     glyph's METAL pixels — a mask cut from the dark-bar template, where the
     bright pixels can only be the glyph. Measuring over every bright pixel in
     the box instead let a white type bar dilute a gold icon down to "silver"
     on all 31 of Light & Dark's white-bar Complex cards. Gold lands around
     +150, silver around 0; the decision line is 60 and a card within
     `UNSURE_BAND` of it is reported, not silently decided.

POSITIVE CONTROL. Every card whose oracle complexity is already Simple or
Complex is classified too and compared: the script prints the agreement and
FAILS if it falls under `MIN_CALIBRATION`. A classifier that cannot reproduce
the 391 known answers has no business filling in the 132 unknown ones.

WHAT IS EMITTED. Only cards whose oracle value is `Common` — the placeholder.
The oracle's own Simple/Complex/Glitch are Caleb's transcription and stay his;
where the scan disagrees with one of those the script says so on stderr and
emits nothing for that card. Each emitted entry carries `from` so the extractor
can refuse a stale entry the day the oracle file is corrected by hand.

Run:  .venv/bin/python bot/pipeline/classify_complexity.py
      then `npm --prefix client/engine run extract` to rebuild catalogue.json.
"""

# ── reaching the bot package ──────────────────────────────────────────
# One directory below bot/, run directly: Python puts THIS directory on
# sys.path, not the package above it. Say so explicitly.
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
# ──────────────────────────────────────────────────────────────────────

import json
import sys
from datetime import date

import numpy as np
from PIL import Image

from paths import CARDS_DIR, ORACLE_JSON, COMPLEXITY_OVERRIDES as OUT

# The glyph's fixed column, with slack; the band of rows it can sit in.
X0, X1 = 596, 676
Y0, Y1 = 700, 960
# Two silver icons whose boxes are known, one on a DARK type bar (Aberrant
# Populace, Fire) and one on a WHITE bar (Banishment, Light): the bar's
# brightness inverts the glyph's contrast, and one template found the icon on
# every dark-bar card and on none of the 53 white-bar ones. Each scan is
# searched with both; the better score wins.
TEMPLATE_CARDS = ("Aberrant Populace", "Banishment")
TEMPLATE_BOX = (613, 819, 657, 858)        # x0, y0, x1, y1 — the same on both
# Below this NCC score we did not find the glyph and say so.
MIN_SCORE = 0.55
# mean(R - B) over the glyph's bright pixels: silver ~0, gold ~150
GOLD_LINE = 60.0
UNSURE_BAND = 25.0
# the positive control's floor
MIN_CALIBRATION = 0.98
# the only oracle value this script is allowed to replace
PLACEHOLDER = "Common"


def load_scan(name):
    p = CARDS_DIR / (name.replace(" ", "-") + ".jpg")
    if not p.exists():
        return None
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float32)


def luminance(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def build_templates():
    """-> (luminance templates, the glyph mask). The mask is the bright part of
    the FIRST template — on its dark bar, bright means metal and nothing else."""
    out = []
    for name in TEMPLATE_CARDS:
        rgb = load_scan(name)
        if rgb is None:
            sys.exit(f"template scan for {name} is missing")
        x0, y0, x1, y1 = TEMPLATE_BOX
        out.append(luminance(rgb)[y0:y1, x0:x1])
    return out, out[0] > 120


def ncc_best(hay, tpl):
    """Best (score, y, x) of the normalised cross-correlation of tpl over hay."""
    h, w = tpl.shape
    tc = tpl - tpl.mean()
    tnorm = float(np.sqrt((tc * tc).sum()))
    # every window at once: (H-h+1, W-w+1, h, w) as a view, no copies
    wins = np.lib.stride_tricks.sliding_window_view(hay, (h, w))
    wc = wins - wins.mean(axis=(2, 3), keepdims=True)
    den = np.sqrt((wc * wc).sum(axis=(2, 3))) * tnorm
    num = (wc * tc).sum(axis=(2, 3))
    scores = np.where(den > 1e-6, num / np.maximum(den, 1e-6), -2.0)
    y, x = np.unravel_index(int(np.argmax(scores)), scores.shape)
    return float(scores[y, x]), int(y), int(x)


def classify(rgb, tpls, mask):
    """-> (label, score, warmth): label is 'Simple' / 'Complex' / None."""
    band = rgb[Y0:Y1, X0:X1]
    lum = luminance(band)
    score, y, x, tpl = max(((*ncc_best(lum, t), t) for t in tpls), key=lambda hit: hit[0])
    if score < MIN_SCORE:
        return None, score, 0.0
    h, w = tpl.shape
    metal = band[y:y + h, x:x + w][mask]
    warmth = float((metal[:, 0] - metal[:, 2]).mean())
    return ("Complex" if warmth > GOLD_LINE else "Simple"), score, warmth


def main():
    oracle = json.loads(ORACLE_JSON.read_text(encoding="utf-8"))
    tpls, mask = build_templates()

    rows = []
    for name, entries in oracle.items():
        e = entries[0] if isinstance(entries, list) and entries else None
        if not e:
            continue
        have = e.get("complexity") or ""
        rgb = load_scan(name)
        if rgb is None:
            rows.append((name, have, None, 0.0, 0.0, "no scan"))
            continue
        label, score, warmth = classify(rgb, tpls, mask)
        note = ""
        if label is None:
            note = "icon not found"
        elif abs(warmth - GOLD_LINE) < UNSURE_BAND:
            note = "unsure"
        rows.append((name, have, label, score, warmth, note))

    # ── the positive control ───────────────────────────────────────────
    known = [r for r in rows if r[1] in ("Simple", "Complex") and r[2] is not None]
    agree = [r for r in known if r[1] == r[2]]
    disagree = [r for r in known if r[1] != r[2]]
    acc = len(agree) / len(known) if known else 0.0
    print(f"calibration: {len(agree)}/{len(known)} known cards reproduced ({acc:.1%})")
    for name, have, label, score, warmth, note in disagree:
        print(f"  DISAGREE {name}: oracle {have}, scan says {label} "
              f"(score {score:.2f}, warmth {warmth:+.0f}) {note}", file=sys.stderr)
    if acc < MIN_CALIBRATION:
        sys.exit(f"calibration {acc:.1%} is under {MIN_CALIBRATION:.0%}; not writing {OUT.name}")

    # ── the cards this fills in ────────────────────────────────────────
    cards = {}
    unsure, unfound = [], []
    for name, have, label, score, warmth, note in rows:
        if have != PLACEHOLDER:
            continue
        if label is None:
            unfound.append((name, note))
            continue
        if note == "unsure":
            unsure.append((name, label, warmth))
        cards[name] = {
            "from": have,
            "to": label,
            "score": round(score, 3),
            "warmth": round(warmth, 1),
            **({"unsure": True} if note == "unsure" else {}),
        }

    split = {"Simple": 0, "Complex": 0}
    for v in cards.values():
        split[v["to"]] += 1
    print(f"filled in {len(cards)} '{PLACEHOLDER}' cards: "
          f"{split['Simple']} Simple, {split['Complex']} Complex")
    for name, note in unfound:
        print(f"  NOT CLASSIFIED {name}: {note}", file=sys.stderr)
    for name, label, warmth in unsure:
        print(f"  UNSURE {name}: {label} at warmth {warmth:+.0f}", file=sys.stderr)

    payload = {
        "_generated_by": "bot/pipeline/classify_complexity.py — never hand-edit",
        "_what": "the oracle file's `complexity` placeholders, read off the type-bar "
                 "icon on each scan: silver = Simple, gold = Complex. `from` is the "
                 "upstream value the entry replaces; the extractor refuses the entry "
                 "if upstream no longer says that.",
        "generated": date.today().isoformat(),
        "calibration": {"agree": len(agree), "known": len(known),
                        "disagree": [r[0] for r in disagree]},
        "cards": dict(sorted(cards.items())),
    }
    OUT.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(CARDS_DIR.parent.parent)}")


if __name__ == "__main__":
    main()
