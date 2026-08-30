#!/usr/bin/env python3
"""build_anchors.py — find each card's graft/augment icon in its own art.

Build-time only. Writes data/cards/mod_anchors.json, which `mods.py` reads to
decide how far to slide a modification card out from under its host.

Why the icon and not a fixed offset: the peek has to reveal exactly the ability
that transfers, and that ability sits on a different line on every card. A card
whose whole text box is the augment paragraph (A Pile of Rubbish) should peek by
one line; Stellarspore Harvester, whose augment is its *second* paragraph, must
peek only that second paragraph and keep the first one hidden — showing it would
claim text transfers that doesn't. The icon is the one landmark that marks where
the transferable ability begins, and it's already drawn on the art.

Matching is a normalized cross-correlation of the shipped data/icons/*.webp glyph
against the card's luminance. Two details make it work:

  * The template is luminance *premultiplied by alpha*. The augment glyph is a
    white hexagon with a black plus cut into it, and that plus lives in the RGB
    channel, not alpha — matching on alpha alone matches a featureless hexagon
    and lands on whatever is brightest.
  * The template keeps a transparent border and the correlation is NOT masked to
    the glyph. Transparent padding reads as 0 (dark), so the match also demands a
    dark surround. Without it the white complexity diamond in the type bar is a
    fine match for a white arrow, and half the graft cards anchor to the diamond.
"""
import json
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

# Locations live in paths.py.
from paths import REPO_ROOT as ROOT, CARDS_DIR, ICONS_DIR, ORACLE_JSON, MOD_ANCHORS as OUT

# The icon never appears above the text box; searching the art wastes time and
# invites false peaks in busy illustration.
SEARCH_TOP = 760
SIZES = range(24, 40, 2)      # observed on-card glyph is 26-34px
PAD = 4                       # transparent border that enforces the dark surround
MIN_SCORE = 0.70              # below this we don't trust the anchor
TEXTBOX_X0, TEXTBOX_X1 = 50, 670   # the rules box, inset from the card edge

# A real [Augment] ability starts a line. Reconfigure's only [Augment] is inside
# its reminder text ("(The first target must have [Augment] to be augmented.)"),
# mid-line — it's a rules reference, not an ability the card grants.
AUGMENT_RE = re.compile(r"(?:^|\{/n\})\s*\[Augment\]")
SWITCH_RE = re.compile(r"\[Switch1?\]")


def icon_for(card):
    """The icon that marks this card's transferable ability, or None.

    The augment symbol can head the TYPE line instead of a line of rules text,
    in which case it grants the attributes it precedes (Chitin Shredder, and 19
    others, whose text box is empty). Those cards carry the glyph on their type
    bar, so the search finds it in exactly the same way — the peek then reveals
    the type bar, which is the ability.
    """
    text = card.get("text") or ""
    if AUGMENT_RE.search(text) or "[Augment]" in (card.get("type") or ""):
        return "augment"
    if "[Switch1]" in text:
        return "bounded_graft"
    if "[Switch]" in text:
        return "graft"
    return None


def _ncc(hay, tpl):
    """Score grid of normalized cross-correlation of `tpl` over `hay`."""
    H, W = hay.shape
    h, w = tpl.shape
    tc = tpl - tpl.mean()
    tnorm = float(np.sqrt((tc * tc).sum()))
    if tnorm == 0:
        return None
    out = np.full((H - h + 1, W - w + 1), -2.0, dtype=np.float32)
    for y in range(H - h + 1):
        for x in range(W - w + 1):
            win = hay[y:y + h, x:x + w]
            wc = win - win.mean()
            den = float(np.sqrt((wc * wc).sum())) * tnorm
            if den > 1e-6:
                out[y, x] = float((wc * tc).sum() / den)
    return out


def find_cut(gray, icon_y):
    """The row to slide the card out to: the blank gap just above the icon's line.

    Cutting a fixed few pixels above the icon is not good enough. Card text lines
    sit close together, so a blind offset shaves the descenders off the line above
    and leaves a readable strip of it on show — and on a card like Stellarspore
    Harvester the line above is its *non-augment* paragraph, which does not
    transfer. Showing it would claim text carries over that doesn't.

    So look for the darkest row (least ink) in the band above the icon: that's the
    leading between the two lines, and it's the honest place to cut.
    """
    band_top = max(0, icon_y - 26)
    band = gray[band_top:icon_y + 1, TEXTBOX_X0:TEXTBOX_X1]
    if band.size == 0:
        return max(0, icon_y - 6)
    ink = (band > 0.6).sum(axis=1)          # bright glyph pixels on the dark box
    best = int(np.argmin(ink[::-1]))        # ties -> the row nearest the icon,
    return band_top + (len(ink) - 1 - best)  # i.e. the smallest peek that's clean


def find_icon(art_path, icon):
    """Locate the first (topmost) instance of `icon` on the card.

    Returns (score, size, x, y, cut) in full-card pixels. A card can carry several
    graft symbols (Amphivore has three); the ability text begins at the topmost
    one, so peaks are gathered and the highest on the card wins, not the
    strongest-scoring one.

    Polarity: base-set frames draw the glyph white on a dark box, which is what
    the template looks like. The Light element's frames are the other way round —
    a dark glyph on a cream box — and since _ncc is zero-mean normalised, that
    inverted pattern scores about -1 instead of +1. So when the normal polarity
    finds nothing, the search is retried against the negated score grid. Positive
    polarity is always tried first, so every previously-anchored card keeps the
    exact anchor it had.
    """
    g = np.asarray(Image.open(art_path).convert("L"), dtype=np.float32) / 255.0
    region = g[SEARCH_TOP:, :]
    src = Image.open(ICONS_DIR / f"{icon}.webp").convert("RGBA")

    grids = []
    for size in SIZES:
        t = np.asarray(src.resize((size, size), Image.LANCZOS), dtype=np.float32) / 255.0
        alpha = t[:, :, 3]
        lum = 0.299 * t[:, :, 0] + 0.587 * t[:, :, 1] + 0.114 * t[:, :, 2]
        tpl = np.pad(lum * alpha, PAD)
        grid = _ncc(region[::2, ::2], tpl[::2, ::2])
        if grid is not None:
            grids.append((size, grid))
    if not grids:
        return None

    best = None
    for sign in (1.0, -1.0):
        cand = None
        for size, grid in grids:
            sgrid = grid * sign
            peak = float(sgrid.max())
            if cand is None or peak > cand[0]:
                cand = (peak, size, sgrid)
        if cand and cand[0] >= MIN_SCORE:
            best = cand
            break
        if best is None:
            best = cand
    if best is None:
        return None
    peak, size, grid = best

    # Every peak worth calling a hit, then take the topmost — with a coarse
    # non-max suppression so the same glyph isn't counted as several peaks.
    thresh = max(MIN_SCORE, peak - 0.05)
    ys, xs = np.where(grid >= thresh)
    hits = sorted(zip(ys.tolist(), xs.tolist()), key=lambda p: (p[0], p[1]))
    chosen = None
    for y, x in hits:
        # Same text line and near-identical position => same glyph.
        if chosen is None or y * 2 < chosen[0] - size // 2:
            chosen = (y * 2, x * 2)
            break
    if chosen is None:
        return None
    y, x = chosen
    # `grid` indexes the top-left of the PADDED template, so the glyph itself
    # begins PAD further in — add it, don't subtract it.
    gx, gy = x + PAD, y + PAD + SEARCH_TOP
    return (peak, size, gx, gy, find_cut(g, gy))


def _one(args):
    name, card = args
    icon = icon_for(card)
    if not icon:
        return name, None
    art = CARDS_DIR / (name.replace(" ", "-") + ".jpg")
    if not art.exists():
        return name, None
    found = find_icon(art, icon)
    if not found:
        return name, None
    score, size, x, y, cut = found
    return name, {
        "icon": icon,
        "x": int(x),
        "y": int(y),
        "size": int(size),
        "cut": int(cut),          # slide the card out to here
        "score": round(float(score), 4),
    }


def main():
    data = json.loads(ORACLE_JSON.read_text())
    cards = {n: f[0] for n, f in data.items() if f}
    todo = [(n, c) for n, c in cards.items() if icon_for(c)]
    print(f"{len(todo)} cards carry a graft/augment ability; locating each icon…")

    anchors = {}
    with ProcessPoolExecutor() as pool:
        for i, (name, rec) in enumerate(pool.map(_one, todo), 1):
            if rec:
                anchors[name] = rec
            if i % 25 == 0:
                print(f"  {i}/{len(todo)}")

    missing = [n for n, _ in todo if n not in anchors]
    weak = sorted((r["score"], n) for n, r in anchors.items() if r["score"] < 0.80)

    OUT.write_text(json.dumps(dict(sorted(anchors.items())), indent=1) + "\n")
    print(f"\nwrote {OUT.relative_to(ROOT)} — {len(anchors)} anchors")
    if missing:
        print(f"no anchor ({len(missing)}): {', '.join(missing)}")
    if weak:
        print(f"low confidence ({len(weak)}), eyeball these:")
        for s, n in weak:
            print(f"  {s:.3f}  {n}")
    return 0 if not missing else 1


if __name__ == "__main__":
    sys.exit(main())
