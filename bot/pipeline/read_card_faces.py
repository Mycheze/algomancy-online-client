#!/usr/bin/env python3
"""read_card_faces.py — read the SYMBOLS off each card scan.

Build-time only. Writes data/cards/card-faces.json, a per-card record of what
is actually printed in the symbol regions of the 720x1000 scans.

WHY THIS EXISTS. The oracle transcription's prose is excellent — it was typed
from the cards and reads clean. Its SYMBOLS were not. The Light & Dark rows
were transcribed from images, and on 2026-09-20 a pass over the scans found
eleven cards wrong, every one of them in Light & Dark:

  * all TEN printed alternative-cost banners had lost their affinity pips.
    Not most: all ten. Angel of Anguish prints [1ld] and recorded [1].
  * TWO of those ten — Calming Force and Vengeance — had lost the whole
    banner, condition and all, and so had no alternative play mode at all.
  * THREE cost orbs had lost a repeated pip: Calming Force ll for lll, Grim
    Bargain dd for ddd, Tithe Enforcer l for ll.

None of it is reachable from the text. A dropped pip leaves a perfectly
well-formed record; affinity is a REQUIREMENT rather than a payment, so
`total_cost` does not constrain the pip count either (see the header of
client/engine/scripts/audit-cards.mjs); and a repeated pip is invisible to any
check that compares elements rather than counts. The scan is the only witness,
which is the whole argument for this file existing.

The timing glyph, by contrast, was already perfect: all 136 {Battle} and 21
{Haste} markers agree with the scans and none is missing. So the failure is
specific — it is the PIP that did not survive transcription, not the symbol.

WHAT IT READS. Four regions, all at fixed geometry on the 720x1000 frame:

  cost orb     the black disc at the top left: a numeral (0-9 or X) and an arc
               of up to three affinity pips hanging off its lower right.
  alt-cost     the banner beneath the title bar carrying an alternative play
               mode — "[1ld] Prophecy — Two Turns Pass", "[4lb] Ambush
               [Battle]". Its own numeral and its own pips, in the same
               shapes but smaller. Ten cards print one.
  timing       the right-hand end of the title bar: crossed swords = battle
               timing, a double chevron = haste, neither = deploy. A unit's
               P/T box sits to the left of it and does not displace it.
  complexity   NOT read here. classify_complexity.py already does it.

HOW. A template bank matched against fixed regions, the same approach
build_anchors.py takes with the augment glyph, with three differences that
this problem forces:

  * The templates are CUT FROM THE SCANS, not from data/icons/*.webp. The
    shipped icons are the Discord emoji renders: `cost_4` is a white disc with
    a black numeral where the card prints a black disc with a white one, and
    the element glyphs ship at 79px and 128px against a printed pip of 30.
    They are the right shapes and the wrong pictures. EXEMPLARS below names one
    hand-verified card per symbol and the bank is cut from those at load.
  * The match is masked to the pip disc and runs on COLOUR, not luminance. Two
    pairs are separable only one way each: light and metal are both white and
    differ by their inner glyph (an S-swirl against a diagonal slash), while
    light and dark share the S-swirl and differ only in value. Matching on
    luminance alone merges the first pair; matching on mean colour alone merges
    the second.
  * PRESENCE is decided by a different feature in each region, because neither
    one works in both. On the orb it is ring contrast: template similarity
    cannot tell a real pip over bright art (0.79) from a slot half-covering
    the orb's own black rim (0.84), while contrast puts every true pip over
    0.189 and every empty slot under 0.085. On the banner it is template
    similarity: a wood pip against a bright plate has almost no ring contrast
    (Air Plant reads 0.028) but still matches its template at 0.83. Each
    threshold below is quoted with the gap it sits in.

POSITIVE CONTROL, and why it is not the Deck field. `Deck` looks like a control
-- it carries an element pair per L&D card and agrees with `cost` 163/163 --
but it is the printer's grouping, not a transcription, so agreeing with it only
proves two columns of one spreadsheet match. The real controls are external to
the thing being tested:

  * the 370 BASE-SET rows, whose text came from algomancer.cc rather than from
    an image, calibrate pip identity, pip count and the numeral;
  * `total_cost` calibrates the numeral templates independently on all 528.

Both are scored on every run and the script FAILS under MIN_AGREEMENT. A reader
that cannot reproduce the rows we already trust has no business reporting the
ones we don't.

WHAT IS EMITTED. Every card's reading, with a confidence per field, plus a
`disagrees` list naming the oracle fields the scan contradicts. Nothing is
corrected automatically: the oracle file is Caleb Gannon's transcription (see
data/NOTICE.md) and a disagreement is a prompt for a human to look at the scan,
not a licence to rewrite his work.

Run:  .venv/bin/python bot/pipeline/read_card_faces.py
      .venv/bin/python bot/pipeline/read_card_faces.py --report   (no write)
"""

# ── reaching the bot package ──────────────────────────────────────────
# One directory below bot/, run directly: Python puts THIS directory on
# sys.path, not the package above it. Say so explicitly.
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
# ──────────────────────────────────────────────────────────────────────

import argparse
import json
import re
import sys
from datetime import date

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view
from PIL import Image

from oracle import load_oracle
from paths import CARDS_DIR, CARD_FACES as OUT

# ── the frame ─────────────────────────────────────────────────────────
# Every scan is 720x1000 and the frame is drawn, not photographed, so these
# are exact rather than approximate. Each was measured off a coordinate
# overlay and then confirmed by maximising ring contrast over a sample:
# the winning centre was unanimous to within a pixel on 27-29 cards of 30.
SCAN_W, SCAN_H = 720, 1000

ORB_CENTRE = (75, 72)
ORB_R = 33
PIP_R = 13                  # an affinity pip on the cost orb

# The pips hang off the orb's lower right on a fixed arc, and slot k is at the
# same place whatever the pip COUNT is -- a one-pip card prints slot 1 and
# nothing else -- so the slots can be probed independently.
PIP_SLOTS = [(116, 76), (104, 104), (76, 115)]

# THE PIPS ARE NOT IN THE ORACLE'S COST ORDER. The frame draws them in its own
# canonical order (A Pile of Runes is `be` and prints earth before water), so a
# reading is compared with the transcription as a MULTISET, never a sequence.

# The alternative-cost banner -- the trapezoid under the title bar that carries
# a Prophecy or Ambush mode. Light & Dark only: the base set prints its Ambush
# inside the text box instead, and none of its 370 cards has this plate.
# It is NOT a Light & Dark exclusive, as the extractor's header assumes:
# Vengeance and Calming Force print one too, and neither records it.
ALT_EDGE_ROWS = (128, 148)  # the plate's bottom outline falls in here...
ALT_EDGE_X = (160, 270)     # ...as a dark stroke right across this span
ALT_PIP_R = 8               # banner pips are smaller than the orb's
ALT_PIP_X = (131, 147)      # ...in this narrow column band. Nine of the ten
                            # banner cards put them at x=135; Vengeance costs
                            # `13`, and the second digit widens the orb and
                            # pushes its whole banner six pixels right.
ALT_PIP_Y = (104, 138)      # two pips sit at y=113 and y=127-128, and a lone
                            # pip is centred between them at y=121

# The title bar's right-hand end, where the timing glyph sits. A unit's P/T is
# drawn to its left and does not displace it.
TIMING_BOX = (595, 48, 690, 102)
TIMING_TPL = (618, 56, 655, 94)    # the glyph's own bounding box

PIP_OF_ELEMENT = {'fire': 'r', 'water': 'b', 'earth': 'e', 'wood': 'g',
                  'metal': 'm', 'light': 'l', 'dark': 'd'}

# One hand-verified card per symbol, read off a 9x crop of its own scan. The
# bank is cut from these at load; see the header for why not data/icons/.
EXEMPLARS = {
    'light': 'Reap the Due',
    'dark': 'Cthyrian Rector',
    'fire': 'All-Consuming Blaze',
    'water': 'Amphivore',
    'earth': 'Bellowing Boulder',
    'wood': 'Burgeon',
    'metal': 'Arcane Echo',
}
TIMING_EXEMPLARS = {'battle': 'Banishment', 'haste': 'Accelerated Germination'}

# The banner has no external control -- the oracle lost the pips on all ten
# cards that print one, so agreeing with the transcription would prove
# nothing. These are the ten read by eye off a 8x crop of each scan, and they
# are checked on every run: they are the only thing standing behind the
# banner numbers, so a change that breaks them has to be looked at.
BANNER_CONTROL = {
    'Air Plant': 'lg', 'Angel of Anguish': 'ld', 'Big Glimpse Card': 'lb',
    'Calming Force': 'll', 'Divine Intervention': 'll', 'Flzzz': 'll',
    'Shib': 'lb', 'The Foretold': 'l', 'Tithe Enforcer': 'll', 'Vengeance': 'lr',
}

# `p` (prismite / shard) is a real cost character that prints NO pip -- Collective
# Creation and Lord of Buddies cost `p` and their orbs carry a numeral alone --
# so it needs no template and no special case: it is simply not in PIP_OF_ELEMENT,
# and oracle_pips() drops it with everything else that is not an element letter.

# Frames whose `cost` is NOT a transcription of printed pips. A token's orb
# carries a bare 0 while the oracle still records the colour it belongs to
# (Fireball is `r`, Wraith is `d`), resources print their pip in the TYPE line
# instead of an orb, and the help cards have neither. Reading these against
# `cost` would report twelve defects that are all the convention working.
NO_PIP_FRAME = re.compile(r'\bToken\b|\bResource\b|\bHelp Card\b')

# ── the decision thresholds, and the gaps they sit in ─────────────────
# Each was chosen at the midpoint of a measured gap on the control set, not
# fitted to it. The gap is quoted so a later change can be judged.
PIP_PRESENT = 0.13    # orb: ring contrast. true pips >= 0.189, empty <= 0.085
ALT_PIP_MIN = 0.68    # banner: template similarity. true >= 0.71, noise <= 0.52
ALT_BANNER_MIN = 0.50 # banner present: outline x plate. true >= 0.666, else <= 0.369
ORB_DARK_MIN = 0.45   # orb present: the disc must be mostly this dark...
ORB_BRIGHT = (0.02, 0.60)   # ...with a numeral in it, which is what rules out
                            # a card whose top-left art is simply black
TIMING_MIN = 0.75     # timing: |NCC|. true >= 0.981, absent <= 0.522
MIN_AGREEMENT = 1.0   # the base-set control must be perfect; it is (325/325)


# ── the primitives ────────────────────────────────────────────────────

def _discs(r, core_f=0.62, ring_lo=0.83):
    """(full, core, ring) boolean masks for a pip of radius `r`."""
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    rr = np.sqrt(xx * xx + yy * yy)
    return rr <= r, rr <= r * core_f, (rr >= r * ring_lo) & (rr <= r)


def _patch(a, centre, r):
    x, y = centre
    return a[y - r:y + r + 1, x - r:x + r + 1]


def ring_contrast(patch, r):
    """How much brighter the middle is than the rim.

    This is what decides whether a pip is PRESENT on the cost orb, and it is
    the only feature that does the job there: template similarity does not,
    because a slot half-covering the orb's own black edge can score 0.84
    against a dark pip (Prickly Protector, Spawning Ground, Worldbender) while
    a real pip over bright art scores 0.79. Contrast separates the same cases
    with nothing in between -- every true pip is over 0.189 and every empty
    slot under 0.085.
    """
    _, core, ring = _discs(r)
    lum = patch.mean(axis=2)
    return float(lum[core].mean() - lum[ring].mean())


def similarity(patch, template, r):
    """1 - RMS colour distance over the pip disc.

    Colour, not luminance, and unnormalised: light and metal are both white
    and separable only by their inner glyph, while light and dark share the
    glyph and are separable only by value. Normalising away brightness would
    merge the second pair; dropping colour would merge the first.
    """
    full, _, _ = _discs(r)
    m = full[..., None]
    d = (patch - template) * m
    return 1.0 - float(np.sqrt((d * d).sum() / (full.sum() * 3)))


def ncc_map(hay, tpl):
    """Normalised cross-correlation of `tpl` over every position in `hay`."""
    h, w = tpl.shape
    tc = tpl - tpl.mean()
    tn = float(np.sqrt((tc * tc).sum()))
    win = sliding_window_view(hay, (h, w))
    wc = win - win.mean(axis=(2, 3), keepdims=True)
    num = (wc * tc).sum(axis=(2, 3))
    den = np.sqrt((wc * wc).sum(axis=(2, 3))) * tn
    return np.where(den > 1e-6, num / np.maximum(den, 1e-9), 0.0)


def scan_path(name):
    return CARDS_DIR / (name.replace(" ", "-") + ".jpg")


def load_scan(name):
    """The scan as float RGB, or None if it is missing or not the print frame."""
    p = scan_path(name)
    if not p.exists():
        return None
    a = np.asarray(Image.open(p).convert('RGB'), dtype=np.float32) / 255.0
    return a if a.shape[:2] == (SCAN_H, SCAN_W) else None


# ── the template bank ─────────────────────────────────────────────────

class Bank:
    """Every template, cut from the scans named in EXEMPLARS at load."""

    def __init__(self):
        self.pip = {}       # element -> orb-scale patch
        self.alt = {}       # element -> banner-scale patch
        self.timing = {}    # 'battle' / 'haste' -> luminance patch
        for el, card in EXEMPLARS.items():
            a = load_scan(card)
            if a is None:
                raise SystemExit(f'exemplar scan missing or wrong size: {card}')
            self.pip[el] = _patch(a, PIP_SLOTS[0], PIP_R)
            # the banner prints the same glyph smaller; resample rather than
            # cut a second exemplar, because the pool has no banner card
            # carrying fire, earth or metal to cut one from.
            n = 2 * ALT_PIP_R + 1
            box = (PIP_SLOTS[0][0] - PIP_R, PIP_SLOTS[0][1] - PIP_R,
                   PIP_SLOTS[0][0] + PIP_R + 1, PIP_SLOTS[0][1] + PIP_R + 1)
            im = Image.open(scan_path(card)).crop(box).resize((n, n), Image.LANCZOS)
            self.alt[el] = np.asarray(im, dtype=np.float32) / 255.0
        x0, y0, x1, y1 = TIMING_TPL
        for tag, card in TIMING_EXEMPLARS.items():
            a = load_scan(card)
            if a is None:
                raise SystemExit(f'timing exemplar missing: {card}')
            self.timing[tag] = a[y0:y1, x0:x1].mean(axis=2)


# ── the four readings ─────────────────────────────────────────────────

def read_orb_pips(a, bank):
    """The affinity pips on the cost orb, as [(element, similarity, margin)]."""
    out = []
    for slot in PIP_SLOTS:
        p = _patch(a, slot, PIP_R)
        if ring_contrast(p, PIP_R) < PIP_PRESENT:
            continue
        sc = sorted(((similarity(p, t, PIP_R), el) for el, t in bank.pip.items()),
                    reverse=True)
        out.append((sc[0][1], round(sc[0][0], 3), round(sc[0][0] - sc[1][0], 3)))
    return out


def has_alt_banner(a):
    """Is the alternative-cost plate printed on this card?

    The plate is a bright panel with a black outline, hung under the title
    bar. Neither half of that alone is enough -- plenty of cards have pale art
    below the title, and plenty have a dark line somewhere -- so the score is
    the product: find the darkest full-width stroke in the rows where the
    plate's bottom edge can fall, then measure how bright the band directly
    above it is. On the ten cards that print a banner this is 0.666 to 0.776
    and on the other 517 it never exceeds 0.369.

    An earlier version tested only the banner's numeral disc. It scored
    Calming Force above every real banner -- which was luck, because Calming
    Force turned out to HAVE a banner the oracle never recorded. Vengeance is
    the same. Both were found by fixing the detector, not by reading the text.
    """
    lum = a.mean(axis=2)
    x0, x1 = ALT_EDGE_X
    rows = [(lum[y, x0:x1] < 0.35).mean() for y in range(*ALT_EDGE_ROWS)]
    edge = max(rows)
    y_edge = ALT_EDGE_ROWS[0] + int(np.argmax(rows))
    inner = float(lum[max(106, y_edge - 22):y_edge - 3, x0:x1].mean())
    return edge * inner


def read_alt_pips(a, bank):
    """The banner's pips, top to bottom.

    A SEARCH down one column rather than fixed slots, because the banner --
    unlike the orb -- moves its pips with their count: two sit at y=113 and
    y=127, a lone one is centred at y=121. Presence is decided on template
    similarity here, not ring contrast, because a banner wood pip is dark
    enough against its bright plate to fall under the contrast line
    (Air Plant reads 0.028) while still matching its template at 0.83.
    """
    r = ALT_PIP_R
    hits = []
    for y in range(*ALT_PIP_Y):
        for x in range(*ALT_PIP_X):
            p = _patch(a, (x, y), r)
            sc = sorted(((similarity(p, t, r), el) for el, t in bank.alt.items()),
                        reverse=True)
            if sc[0][0] >= ALT_PIP_MIN:
                hits.append((sc[0][0], x, y, sc[0][1], sc[0][0] - sc[1][0]))
    hits.sort(reverse=True)
    keep = []
    for h in hits:
        # 11, not 8: the x band is wide enough that a big dark pip can peak
        # twice across it, and the two real slots are 14-15px apart anyway.
        if any((h[1] - k[1]) ** 2 + (h[2] - k[2]) ** 2 < 11 ** 2 for k in keep):
            continue
        keep.append(h)
    return [(k[3], round(k[0], 3), round(k[4], 3)) for k in sorted(keep, key=lambda k: k[2])]


def read_timing(a, bank):
    """'battle', 'haste' or 'deploy', with the winning score.

    |NCC|, not NCC: the glyph is drawn in the title's own colour, so it is
    black on a white bar and white on a dark one and the correlation flips
    sign with the card.
    """
    x0, y0, x1, y1 = TIMING_BOX
    sub = a[y0:y1, x0:x1].mean(axis=2)
    best = {tag: float(np.abs(ncc_map(sub, t)).max()) for tag, t in bank.timing.items()}
    tag = max(best, key=best.get)
    return (tag if best[tag] >= TIMING_MIN else 'deploy'), round(best[tag], 3)


def has_orb(a):
    """Is a cost orb printed on this card?

    Two conditions, because either alone is wrong. The orb is a large solid
    near-black disc -- but so is the top-left corner of Dark Resource and of
    the card backs, which have no orb at all. What those lack is the orb's
    white numeral, so the disc must also carry a little bright ink, and not
    be bright all over (a blank card reads 100% bright).
    """
    r = ORB_R
    lum = _patch(a, ORB_CENTRE, r).mean(axis=2)
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    inside = (xx * xx + yy * yy) <= (r * 0.9) ** 2
    dark = float((lum[inside] < 0.22).mean())
    bright = float((lum[inside] > 0.65).mean())
    return dark >= ORB_DARK_MIN and ORB_BRIGHT[0] <= bright <= ORB_BRIGHT[1]


# ── the oracle side ───────────────────────────────────────────────────

PIPS = ''.join(PIP_OF_ELEMENT.values())
PROPHECY_RE = re.compile(rf'^\s*\[?\s*(\d+)\s*([{PIPS}]*)\s*\]?\s*Prophecy\s*[—–-]')
AMBUSH_RES = [re.compile(rf'\[Battle\]\s*Ambush\s*\[(\d*)([{PIPS}]*)\]'),
              re.compile(rf'\[(\d*)([{PIPS}]*)\]\s*Ambush\s*\[Battle\]')]


def oracle_banner(text):
    """The alternative-cost mode the transcription records, or None.

    Returns (kind, mana, pips). The first line only, like the extractor: a
    prophecy GRANTED by rules text is not a printed banner.
    """
    first = (text or '').split('{/n}')[0]
    m = PROPHECY_RE.match(first)
    if m:
        return 'prophecy', m.group(1), m.group(2)
    for rx in AMBUSH_RES:
        m = rx.search(text or '')
        if m:
            return 'ambush', m.group(1), m.group(2)
    return None


def oracle_timing(type_line):
    if '{Battle}' in (type_line or ''):
        return 'battle'
    if '{Haste}' in (type_line or ''):
        return 'haste'
    return 'deploy'


def oracle_pips(cost):
    """The affinity pips the transcription records, sorted. `p` prints none.

    `empty` is the literal the help cards carry in this field, not a cost --
    and it spells two pip letters, so it has to be caught before the filter.
    """
    if (cost or '') == 'empty':
        return ''
    return ''.join(sorted(c for c in (cost or '') if c in PIPS))


# ── the run ───────────────────────────────────────────────────────────

def read_all(oracle, bank):
    """Every card's face, plus the fields where the scan contradicts the oracle."""
    faces, skipped = {}, []
    for name, recs in oracle.items():
        card = recs[0]
        a = load_scan(name)
        if a is None:
            skipped.append((name, 'no scan at the print size'))
            continue
        face = {'timing': None, 'orb': None, 'alt': None, 'disagrees': []}

        tag, tscore = read_timing(a, bank)
        face['timing'] = {'read': tag, 'score': tscore}
        want = oracle_timing(card.get('type'))
        if tag != want:
            face['disagrees'].append(
                {'field': 'type', 'scan': tag, 'oracle': want,
                 'detail': f'the title bar shows {tag} timing, the type line says {want}'})

        if has_orb(a):
            pips = read_orb_pips(a, bank)
            read = ''.join(sorted(PIP_OF_ELEMENT[e] for e, _, _ in pips))
            face['orb'] = {'pips': read,
                           'detail': [{'element': e, 'score': s, 'margin': m} for e, s, m in pips]}
            have = oracle_pips(card.get('cost'))
            if read != have and not NO_PIP_FRAME.search(card.get('type') or ''):
                face['disagrees'].append(
                    {'field': 'cost', 'scan': read, 'oracle': have,
                     'detail': f'the cost orb prints [{read}], the oracle cost is {card.get("cost")!r}'})

        if has_alt_banner(a) >= ALT_BANNER_MIN:
            pips = read_alt_pips(a, bank)
            read = ''.join(PIP_OF_ELEMENT[e] for e, _, _ in pips)
            face['alt'] = {'pips': read,
                           'detail': [{'element': e, 'score': s, 'margin': m} for e, s, m in pips]}
            ob = oracle_banner(card.get('text'))
            if ob is None:
                face['disagrees'].append(
                    {'field': 'text', 'scan': f'a banner carrying [{read}]', 'oracle': 'no banner',
                     'detail': 'the card prints an alternative-cost banner the text does not record'})
            elif ''.join(sorted(ob[2])) != ''.join(sorted(read)):
                face['disagrees'].append(
                    {'field': 'text', 'scan': read, 'oracle': ob[2],
                     'detail': f'the {ob[0]} banner prints [{ob[1]}{read}], '
                               f'the text records [{ob[1]}{ob[2]}]'})
        else:
            ob = oracle_banner(card.get('text'))
            if ob and ob[0] == 'prophecy':
                face['disagrees'].append(
                    {'field': 'text', 'scan': 'no banner', 'oracle': 'a prophecy banner',
                     'detail': 'the text records a prophecy banner the scan does not print'})
        faces[name] = face
    return faces, skipped


def banner_control(faces):
    """Score the banner reader against the ten hand-read cards."""
    bad = []
    for name, want in sorted(BANNER_CONTROL.items()):
        face = faces.get(name)
        got = face['alt']['pips'] if face and face['alt'] else None
        if got is None or ''.join(sorted(got)) != ''.join(sorted(want)):
            bad.append((name, want, got))
    extra = sorted(n for n, f in faces.items() if f['alt'] and n not in BANNER_CONTROL)
    return len(BANNER_CONTROL) - len(bad), bad, extra


def control(oracle, faces):
    """Score the reader against the rows that were NOT transcribed from images.

    The base set's text came from algomancer.cc, so its pips are independent
    of anything a symbol reader could get wrong. Resources, tokens and help
    cards are excluded: they print no orb.
    """
    agree = disagree = 0
    bad = []
    for name, recs in oracle.items():
        card = recs[0]
        if (card.get('source') or '').startswith('algomancer'):
            continue
        face = faces.get(name)
        if not face or not face['orb']:
            continue
        if NO_PIP_FRAME.search(card.get('type') or ''):
            continue
        want = oracle_pips(card.get('cost'))
        got = face['orb']['pips']
        if want == got:
            agree += 1
        else:
            disagree += 1
            bad.append((name, want, got))
    return agree, disagree, bad


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--report', action='store_true',
                    help='print the findings and write nothing')
    args = ap.parse_args(argv)

    oracle = load_oracle()
    bank = Bank()
    faces, skipped = read_all(oracle, bank)
    agree, disagree, bad = control(oracle, faces)
    bagree, bbad, bextra = banner_control(faces)

    total = agree + disagree
    rate = agree / total if total else 0.0
    print(f'read {len(faces)} scans ({len(skipped)} skipped)')
    print(f'base-set control: {agree}/{total} cost orbs agree ({rate:.4f})')
    for name, want, got in bad:
        print(f'  CONTROL MISS  {name}: oracle {want!r}, scan {got!r}')
    print(f'banner control:   {bagree}/{len(BANNER_CONTROL)} hand-read banners reproduced')
    for name, want, got in bbad:
        print(f'  CONTROL MISS  {name}: hand-read {want!r}, scan {got!r}')
    for name in bextra:
        print(f'  NEW BANNER    {name}: a banner not in BANNER_CONTROL -- read it by eye')

    found = {n: f for n, f in faces.items() if f['disagrees']}
    print(f'\n{len(found)} cards where the scan contradicts the oracle:\n')
    for name in sorted(found):
        card = oracle[name][0]
        where = 'Light & Dark' if (card.get('source') or '').startswith('algomancer') else 'base set'
        print(f'  {name}  ({where})')
        for d in found[name]['disagrees']:
            print(f'      {d["field"]}: {d["detail"]}')

    if bbad or bextra:
        print('\nFAIL: the banner reader no longer reproduces what was read by eye.',
              file=sys.stderr)
        return 1

    if rate < MIN_AGREEMENT:
        print(f'\nFAIL: the control is below {MIN_AGREEMENT:.2f}. A reader that cannot '
              f'reproduce the rows we already trust does not get to report the others.',
              file=sys.stderr)
        return 1

    if args.report:
        return 0
    payload = {
        'generated': str(date.today()),
        'generator': 'bot/pipeline/read_card_faces.py',
        'control': {'agree': agree, 'of': total},
        'cards': faces,
    }
    OUT.write_text(json.dumps(payload, indent=1, sort_keys=True) + '\n')
    print(f'\nwrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
