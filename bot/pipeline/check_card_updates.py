#!/usr/bin/env python3
"""check_card_updates.py — has Caleb changed a card since we last looked?

A REPORT, like read_card_faces.py: nothing consumes its output, a human reads
it and then edits ORACLE_JSON by hand. It never writes to data/.

WHY THIS EXISTS
---------------
Cards get errataed. Caleb announces it in his Discord's #card-changes, which
this repo cannot read directly — the bot is in one guild, the owner's, and gets
403 on that channel. A follow mirrors it into the owner's own server, and that
is the intended route for the WHY of a change; nothing was watching either one
for the WHAT. So between 2026-08-19 and 2026-09-21 ten Light & Dark cards
drifted and nothing in this repo noticed. Stalwart Sentinel
gained `[once]`; Deathcoil Construct went 3 mana to 5; Feed to Hooba changed
the VERB, from erase to delete, which is a different thing happening to the
unit. Every one of those was live in the client, wrong, for a month.

algomancer.cc is the way in. `https://www.algomancer.cc/api/cards` returns all
511 cards, and since 2026-09-21 each record carries:

    rulesVersion       1 for untouched, 2+ for revised
    rulesUpdatedAt     when
    lastChangeSummary  what, in Caleb's site's words:
                       "Mana: 3 -> 5 | Stats: 3/3 -> 3/2 | Affinity ... updated"
    imageUrl           a revision-hashed URL once a card has been revised

So this is a change FEED and not merely a card list. That is the whole reason
to prefer it to scraping Discord.

⚠ THE VERSION FIELD IS NOT A COMPLETE HISTORY. Every 2026-09-21 revision
carries the identical timestamp 03:43:50, which is the site BACKFILLING its own
revision tracking, not eleven edits in one second. Anything Caleb changed
before the site started tracking is baked into `rulesVersion: 1` and is
invisible to the version field. Hence the field-by-field diff below: the
version is the loud signal, the diff is the quiet one, and only the diff would
have caught a pre-backfill drift.

⚠ THE IMAGE IS THE RECORD. THE FIELDS ARE NOT.
----------------------------------------------
The single most important thing to know about this feed, from the owner
(2026-09-21): **algomancer.cc does not OCR oracle text. It stores a card's
name, its colour and its image, and that is all.**

Everything else in a record is either typed in by hand or absent, which
explains every oddity below at once — why 154 of the 163 expansion cards have
an empty `abilities`, why Collect Remains claims 4 mana while its own picture
prints 2, and why searching the site cannot tell Light from Dark. It also means
the site NEVER RE-RENDERS A CARD: a revision-hashed `imageUrl` is a NEW FILE
CALEB UPLOADED, not a regeneration. So when an image changes, the change is
his, and the image is evidence in a way that no field on the record is.

Read that the other way and it is the rule for using this script: **the feed
tells you WHICH cards to look at; the scan tells you WHAT changed.** Never
copy a field out of the report into the oracle. Open the new art.

(Written after getting this backwards. Tithe Enforcer's new scan has no
Prophecy banner, and the theory that a re-render had dropped it was elaborate,
internally consistent and wrong — there is no renderer. Caleb removed the
banner.)

WHAT THE UPSTREAM FEED GETS WRONG, AND WHY THAT IS HARDCODED HERE
-----------------------------------------------------------------
The site is authoritative for its own revisions and unreliable everywhere else
— all of it the no-OCR fact showing through. Each quirk is a FILTER below
rather than a note in a README, because an unfiltered diff is 112 cards of
noise and nobody reads the 112th.

⚠ THE SITE KEEPS RETYPING ITS RECORDS, and every retyping is a new notation.
By 2026-10-01 it had filled in the Light & Dark abilities, started recording
Dark, written X as `X`, grown a `prophecy` field and spelled an Ambush cost
`[4; Water 2]` — and the checker, still normalising the 2026-09-21 notation,
posted ~37 "changed" cards to Discord every day, every one of them the same
card spelled two ways. So when this report fills up overnight, SUSPECT THE
NOTATION FIRST: if the lines read identically to a person, teach flatten()
the new spelling rather than muting the cards.

As of 2026-09-21 the feed got these wrong (several are fixed upstream since,
noted inline; the filters stay, because a record the site has not retyped
still has the old shape):

  * DARK AFFINITY WAS MISSING (reported since 2026-10-01, and it matches
    ours on every card). 53 pure-Dark cards reported `affinity: {}` and
    every Dark hybrid reports only its other half — Blightsea Polyp is
    `{water: 1}` where the scan prints a water pip and a dark pip. Exactly one
    card in 511 reports a lowercase `dark` at all. Our own pips were read off
    the scans by read_card_faces.py and are the better record; do not "fix"
    ours to match.
  * X WAS FLATTENED TO 0 (written `X` since 2026-10-01).
  * SPELLS REPORT 0/0 where our oracle leaves power and toughness blank.
  * LIGHT & DARK ABILITIES WERE EMPTY (25 blanks left on 2026-10-01) — 154 of the 163, a month after
    the expansion's rows were transcribed here from the scans. The nine that
    are filled are exactly the nine revised on 2026-09-21. So a BLANK site
    ability is not evidence that a card has no text; it is the site having
    never typed it in, and a text diff against blank is meaningless.
  * THERE WAS NO FIELD FOR AN ALTERNATIVE COST. Since 2026-10-01 a Prophecy
    banner is a `prophecy` field ({manaCost, affinity, condition}) and NOT in
    the ability text, and an Ambush banner is inline in the ability text as
    `[4; Water 2] Ambush battle`. So our banner line is split off and checked
    against `prophecy`, and both cost spellings flatten to one. That covers
    the Tithe Enforcer case (a banner removed) only once the site has typed
    the removal in — the scan is still the first witness, which is what
    read_card_faces.py's BANNER_CONTROL is for.
  * COLOURLESS IS `prismite`. The eighteen colourless cards (Prismite, the
    Stolen Cards, Shard Resource…) report `{prismite: 1}` where our cost has
    no affinity letters at all. It is the site's "none", not an element.

The casing tells you which records the site has touched by hand, incidentally:
the 2026-09-21 batch writes `{"light": 1}` and everything older writes
`{"Light": 1}`.

NOTATION. Our oracle and the site write the same card two ways, and neither is
wrong — ours is the icon vocabulary the client renders (`[Switch1]`,
`[Augment]`, `[once]`, `[e]`, `[4bb]`, `/[a or b]`, a `{/n}` after a printed
line-break hyphen), the site's is prose (`GRAFT1`, `AUGMENT`, `1X`, `earth`,
`[4; Water 2]`, `[a or b]`, `non-token`). flatten() maps both onto one
spelling before comparing so that a diff means a diff. Note that the hexagon-of-arrows is `[Switch1]` here and `GRAFT1`
there for the SAME glyph; the repo's naming is older than the site's.

ART. `image` in ORACLE_JSON records the URL a card's scan came from. The site
re-points that URL to a revision hash when the art changes, so comparing the
two strings finds art drift without downloading a byte. That is the only reason
the field is kept current — nothing reads it (extract-printed.mjs derives the
filename from the card's name), so it exists to be a provenance stamp.

USAGE
-----
    .venv/bin/python bot/pipeline/check_card_updates.py            # fetch + report
    .venv/bin/python bot/pipeline/check_card_updates.py --offline  # re-read the cache
    .venv/bin/python bot/pipeline/check_card_updates.py --quiet    # exit code only

Exit 0 when we are level with upstream, 1 when anything needs a human. The
second is what makes it usable from a timer.
"""

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import paths  # noqa: E402

API = "https://www.algomancer.cc/api/cards"
# The site 403s a bare urllib UA, exactly as calebgannon.com does.
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

#: cost letter -> the site's element name. Derived once from the 510 matched
#: cards and pinned here; `l`/`d` are Light and Dark, the 2026-08 additions.
LETTERS = {"e": "earth", "m": "metal", "r": "fire",
           "g": "wood", "b": "water", "l": "light", "d": "dark"}

#: our icon vocabulary -> the site's prose, applied to OUR text before
#: comparing. Order matters: [Switch1] must be tried before [Switch].
ICONS = [
    (r"\[Switch1\]", "graft1"), (r"\[Switch\]", "graft"),
    (r"\[Augment\]", "augment"), (r"\[once\]", "1x"),
    (r"\[Haste\]", "haste"), (r"\[Battle\]", "battle"), (r"\[Virus\]", "virus"),
    (r"\[zero\]", "0"), (r"\[one\]", "1"), (r"\[two\]", "2"), (r"\[three\]", "3"),
]

#: A cost in a bracket — an Ambush or Prophecy price. Ours is the client's
#: cost string, `[4bb]`; the site's is spelled out, `[4; Water 2]`. Both are
#: rewritten to one form, `cost 4 water 2`, before anything else touches them.
OUR_COST = re.compile(r"\[(\d+|X)([emrgbld]+)\]")
SITE_COST = re.compile(r"\[(\d+|X);\s*([^\]]*)\]", re.I)

#: Our Prophecy banner: the first line of the text, `[2lg] Prophecy — <condition>`.
#: The site keeps the same banner in a `prophecy` field and leaves it out of the
#: ability text, so it is split off ours and compared there instead. (A card
#: that GRANTS Prophecy — "It gains 'Prophecy — One Turn Passes'" — has no
#: cost bracket in front and is not a banner.)
BANNER = re.compile(r"^\s*\[(\d+|X)([a-z]*)\]\s*Prophecy\s*[—–-]\s*(.*?)\s*(?:\{/n\}|$)")

#: Applied to BOTH sides last, so the two phrasings of one step compare equal.
#: The site spells out what our icon vocabulary draws.
PHRASES = [(r"\bthe haste step\b", "haste"), (r"\bthe battle step\b", "battle")]

#: Structural fields we have LOOKED at and judged wrong upstream, keyed by the
#: card and the exact value we judged. Same reasoning as UPSTREAM_NOISE: pin the
#: value, not the card, so that a later change to the same field is reported.
UPSTREAM_BAD_FIELD = {
    # The owner checked the current printed card on 2026-09-21: it costs 2 and
    # self-erases, which is exactly our row. The site says 4 and carries
    # rulesVersion 1, meaning it does not consider this a revision at all — and
    # since the site does not OCR, there is nothing behind the number.
    ("Collect Remains", "mana"): ("2", 4, "owner read the printed card 2026-09-21: it costs 2"),
}

#: Cards where we have LOOKED and concluded the upstream record is the wrong
#: one, keyed by the exact upstream string we judged. Keyed by the string and
#: not by the card name on purpose: if Caleb edits one of these, the string
#: stops matching and the card comes straight back into the report. A name-keyed
#: mute would swallow the next real change to the same card forever.
#: (Empty since 2026-10-01: the site retyped both strings that were here — a
#: `Sacrifce` typo and a leaked `[three_blue]` pip — and both now match ours.)
UPSTREAM_NOISE: dict[str, str] = {}


def fetch(offline: bool) -> list[dict]:
    """The upstream feed, rotating the previous fetch aside on success."""
    cache = paths.upstream_cards()
    if offline:
        if not cache.exists():
            sys.exit(f"no cached feed at {cache} — run without --offline once.")
        return json.loads(cache.read_text(encoding="utf-8"))

    req = urllib.request.Request(API, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode("utf-8")
    rows = json.loads(body)
    if not isinstance(rows, list) or len(rows) < 400:
        sys.exit(f"upstream returned {type(rows).__name__} of unexpected size — refusing to cache it.")

    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists():
        paths.upstream_cards_prev().write_text(cache.read_text(encoding="utf-8"), encoding="utf-8")
    cache.write_text(body, encoding="utf-8")
    return rows


def key(name: str) -> str:
    """Match names across the two sources. The site prints one typo we have to
    absorb — `Counter Theif` for our `Counter Thief` — and hyphens, apostrophes
    and case differ freely."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower()).replace("theif", "thief")


def our_affinity(cost: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for ch in (cost or ""):
        if ch in LETTERS:
            out[LETTERS[ch]] = out.get(LETTERS[ch], 0) + 1
    return out


def site_affinity(aff: dict | None) -> dict[str, int]:
    """`prismite` is the site's word for colourless, not an element: our
    colourless cards carry no affinity letters at all."""
    return {k.lower(): v for k, v in (aff or {}).items() if v and k.lower() != "prismite"}


def cost_words(total: str, aff: dict[str, int]) -> str:
    """One spelling for a bracketed cost, whichever side wrote it."""
    return " ".join(["cost", str(total).lower()] + [f"{k} {aff[k]}" for k in sorted(aff)])


def split_banner(text: str) -> tuple[re.Match | None, str]:
    """Our Prophecy banner line, and the text after it."""
    m = BANNER.match(text or "")
    return (m, (text or "")[m.end():]) if m else (None, text or "")


def flatten(text: str) -> str:
    """Both sides down to one comparable string: icons mapped to prose,
    formatting markers dropped, reminder text dropped (our oracle carries it
    for some cards and not others), punctuation and case discarded."""
    text = SITE_COST.sub(lambda m: cost_words(m[1], site_affinity(
        {k: int(v) for k, v in re.findall(r"([A-Za-z]+)\s*(\d+)", m[2])})), text or "")
    text = OUR_COST.sub(lambda m: cost_words(m[1], our_affinity(m[2])), text)
    for pat, word in ICONS:
        text = re.sub(pat, f" {word} ", text)
    text = re.sub(r"\([^)]*\)", " ", text)          # reminder text
    text = re.sub(r"\{/?[a-z0-9]+\}", " ", text)    # {i} {/i} {i1} {/n} {g} {p}
    text = re.sub(r"/\s*\[", "[", text)             # our `/[a or b]` choice bracket
    text = re.sub(r"\[([a-z])\]", lambda m: LETTERS.get(m.group(1), m.group(1)), text)
    # A hyphen between two letters, line break or not: `sacri- {/n}fices` and
    # `non- {/n}token` on our side, `non-token` on theirs, all close up.
    text = re.sub(r"(?<=[A-Za-z])-\s*(?=[A-Za-z])", "", text)
    text = text.lower()
    for pat, word in PHRASES:
        text = re.sub(pat, word, text)
    text = re.sub(r"[^a-z0-9+/]+", " ", text)
    return " ".join(text.split())


def compare(ours: dict, site: list[dict]) -> tuple[list[dict], list[str]]:
    """Every card that needs a human, and the names that did not line up."""
    by_site = {key(r["name"]): r for r in site}
    findings, unmatched = [], []

    for name, rows in ours.items():
        o = rows[0]
        s = by_site.pop(key(name), None)
        if s is None:
            # Help cards, the KSX promos, tokens and the two resources are ours
            # alone and are expected here; anything else is worth a look.
            if o.get("type") not in (None, "") and "Help Card" not in o["type"]:
                unmatched.append(f"ours only: {name} ({o['type']})")
            continue

        ld = s["set"]["name"] != "Core Set"
        ver = s.get("rulesVersion") or 1
        notes: list[str] = []

        judged = UPSTREAM_BAD_FIELD.get((name, "mana"))
        # The old feed wrote X as 0; only that exact pair is the old shape.
        x_as_zero = o.get("total_cost") == "X" and str(s["manaCost"]) == "0"
        if (str(o.get("total_cost")) != str(s["manaCost"]) and not x_as_zero
                and not (judged and judged[0] == str(o.get("total_cost")) and judged[1] == s["manaCost"])):
            notes.append(f"mana {o['total_cost']} -> {s['manaCost']}")

        # P/T ONLY FOR UNITS. Caleb's sheet carries printer bookkeeping in those
        # two columns for everything else — Fireball, a burst spell token, is
        # recorded 3/3 and Dormant Resource 2/0 — and the site writes 0/0 there.
        # Comparing them on a non-unit is two conventions disagreeing, forever.
        if s["typeAndAttributes"].get("mainType") == "Unit":
            for ours_f, site_f in (("power", "power"), ("toughness", "defense")):
                sv = s["stats"].get(site_f)
                if sv is not None and o.get(ours_f) not in ("", None, "X") and str(o[ours_f]) != str(sv):
                    notes.append(f"{ours_f} {o[ours_f]} -> {sv}")

        oa, sa = our_affinity(o.get("cost", "")), site_affinity(s.get("stats", {}).get("affinity"))
        # A blank site affinity is a record nobody typed in, not a colourless card.
        # A record with no dark at all may be one the site has not retyped since
        # it started recording Dark, so dark is compared only where it appears.
        if "dark" not in sa:
            oa = {k: v for k, v in oa.items() if k != "dark"}
        if oa != sa and sa:
            notes.append(f"affinity {oa} -> {sa} (ours is read off the scan)")

        banner, text = split_banner(o.get("text", ""))
        # Only a feed that HAS the field can say a banner is missing: a cached
        # pre-2026-10-01 fetch has no `prophecy` key at all.
        if "prophecy" in s:
            sp = s["prophecy"]
            if banner and not sp:
                notes.append(f"upstream has no Prophecy banner\n      ours: {banner[0].strip()}")
            elif sp and not banner:
                notes.append(f"upstream has a Prophecy banner we lack\n      site: "
                             f"[{sp.get('manaCost')}; {sp.get('affinity')}] Prophecy — {sp.get('condition')}")
            elif sp and banner:
                if (str(sp.get("manaCost")) != banner[1]
                        or site_affinity(sp.get("affinity")) != our_affinity(banner[2])
                        or flatten(sp.get("condition", "")) != flatten(banner[3])):
                    notes.append(f"Prophecy banner\n      ours: {banner[0].strip()}\n      site: "
                                 f"[{sp.get('manaCost')}; {sp.get('affinity')}] Prophecy — {sp.get('condition')}")

        st = " ".join(s.get("abilities") or [])
        # A blank upstream ability is the site never having typed it, for 154
        # of the 163 expansion cards. Only compare when there is something there.
        if st in UPSTREAM_NOISE:
            pass                                    # judged already; see the dict
        elif st.strip():
            if flatten(text) != flatten(st):
                notes.append(f"text\n      ours: {o.get('text') or '(none)'}\n      site: {st}")
        elif not ld and (o.get("text") or "").strip():
            notes.append(f"upstream dropped the text of a CORE card\n      ours: {o['text']}")

        if o.get("image", "").startswith("http") and o["image"] != s.get("imageUrl"):
            notes.append(f"art moved\n      ours: {o['image']}\n      site: {s.get('imageUrl')}")

        if notes:
            findings.append({"name": name, "version": ver, "notes": notes})

    for k, r in by_site.items():
        unmatched.append(f"site only: {r['name']} ({r['set']['name']})")
    return findings, unmatched


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--offline", action="store_true", help="re-read the cached feed, do not fetch")
    ap.add_argument("--quiet", action="store_true", help="exit code only")
    args = ap.parse_args(argv)

    site = fetch(args.offline)
    ours = json.loads(paths.ORACLE_JSON.read_text(encoding="utf-8"))
    findings, unmatched = compare(ours, site)

    if args.quiet:
        return 1 if findings else 0

    print(f"upstream: {len(site)} cards   ours: {len(ours)} entries"
          f"   cache: {paths.upstream_cards()}\n")
    if not findings:
        print("Level with upstream — nothing to do.")
    for f in findings:
        print(f"### {f['name']}  (upstream v{f['version']})")
        for n in f["notes"]:
            print(f"    - {n}")
        print()
    if unmatched:
        print("Names that did not line up (expected: help cards, tokens, KSX promos):")
        for u in unmatched:
            print(f"    {u}")
    print(f"\n{len(findings)} card(s) need a human.")
    print("Fix them IN data/cards/AlgomancyCards-OracleText.json — it is canonical — "
          "against the SCAN, not against this report, then `npm --prefix client/engine run extract`.")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
