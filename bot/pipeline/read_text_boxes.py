#!/usr/bin/env python3
"""read_text_boxes.py — where each card's TYPE BAR (and the rules box under it)
starts on its scan.

Build-time only. Writes data/cards/text-boxes.json, which the client's
`npm run extract` carries into catalogue.json as `textTop`, a fraction of the
scan's height.

Why: the card zoom greys out the rules of a unit whose abilities or attributes
are switched off (owner, 2026-09-27: "Units that have their abilities removed
or turned off don't visually show it in the new zoom view"). The rules box is
not in one place — its top sits anywhere from ~60% to ~90% down the card,
with the art taking whatever the text leaves — so a fixed band greys art on a
short box and misses text on a tall one.

The landmark is the Simple/Complex diamond at the right end of the type bar,
which classify_complexity.py already finds on every scan: this script reuses
its matcher and its templates rather than growing a second one. The diamond's
top sits BAR_INSET px below the bar's top edge on every frame (checked by eye
on eight cards, short and tall boxes, dark and white bars, match scores 0.66 to
1.0). A scan whose diamond is not found is left out, and the client falls back
to the median.
"""

# ── reaching the bot package ──────────────────────────────────────────
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
# ──────────────────────────────────────────────────────────────────────

import json
import statistics
import sys

from paths import CARDS_DIR, ORACLE_JSON, TEXT_BOXES as OUT
from classify_complexity import MIN_SCORE, X0, X1, Y0, Y1, build_templates, load_scan, luminance, ncc_best

#: the diamond's top edge, below the type bar's top edge, in scan px
BAR_INSET = 4


def bar_top(rgb, tpls):
    """-> (y of the type bar's top edge in scan px, match score), or (None, score)"""
    lum = luminance(rgb[Y0:Y1, X0:X1])
    score, y, _x = max((ncc_best(lum, t) for t in tpls), key=lambda hit: hit[0])
    if score < MIN_SCORE:
        return None, score
    return Y0 + y - BAR_INSET, score


def main():
    oracle = json.loads(ORACLE_JSON.read_text(encoding="utf-8"))
    tpls, _mask = build_templates()
    out, missed = {}, []
    for name in sorted(oracle):
        rgb = load_scan(name)
        if rgb is None:
            continue
        top, score = bar_top(rgb, tpls)
        if top is None:
            missed.append((name, score))
            continue
        out[name] = {"top": int(top), "score": round(score, 3)}
    tops = [v["top"] for v in out.values()]
    print(f"type bar found on {len(out)} scans; top from {min(tops)} to {max(tops)} px, "
          f"median {statistics.median(tops):.0f}")
    for name, score in missed:
        print(f"  NOT FOUND {name} (best score {score:.2f})", file=sys.stderr)
    OUT.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(CARDS_DIR.parent.parent)}")


if __name__ == "__main__":
    main()
