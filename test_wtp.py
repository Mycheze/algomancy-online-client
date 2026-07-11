#!/usr/bin/env python3
"""
test_wtp.py — offline checks for the "What's the play?" puzzle engine and its
web endpoints. Same shape as test_draft.py: no Discord token and no network, so
it runs anywhere.

  .venv/bin/python test_wtp.py
"""

import json
import random
import shutil
import tempfile
from pathlib import Path

import wtp

PASS, FAIL = 0, 0


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✅ {label}")
    else:
        FAIL += 1
        print(f"  ❌ {label} {extra}")


def section(title):
    print(f"\n=== {title} ===")


# A puzzle whose whole point is the rule that a column deals damage equal to the
# COMBINED power of the units in it — so the numbers here are load-bearing and are
# asserted below.
SAMPLE = {
    "title": "Read the whole column",
    "question": "You're at 4. Which column do you block?",
    "difficulty": "easy",
    "tags": ["combat math"],
    "author": "Test",
    "phase": "Battle", "turn": "opponent", "initiative": "opponent",
    "opponent": {
        "name": "Opponent", "life": 22, "resources": {"earth": 2, "fire": 1},
        "hand_count": 2,
        "columns": [
            [{"card": "Bumblecrab", "role": "attacking"},
             {"card": "Carapace Devourer", "role": "attacking"}],
            [{"card": "Ephemeral Skywalker", "role": "attacking"}],
        ],
    },
    "you": {
        "name": "You", "life": 4, "resources": {"earth": 3},
        "columns": [[{"card": "Ambling Mountaintop"}]],
        "hand": ["Sprouter"],
    },
    "solution": "Block column 1.",
    "hints": ["A column's damage is the sum of the whole column."],
}


def main():
    section("schema + card resolution")
    p = wtp.from_json(SAMPLE)
    check("parses", p.title == "Read the whole column")
    check("mints an id", p.id.startswith("wtp-"), p.id)
    check("no validation warnings", wtp.validate(p) == [], wtp.validate(p))

    opp_c1 = p.opponent.columns[0]
    check("front row is index 0 (Bumblecrab in front)",
          opp_c1[0].resolved()[0] == "Bumblecrab")
    check("Bumblecrab resolves 2/3", opp_c1[0].stats() == (2, 3), opp_c1[0].stats())
    check("Carapace Devourer resolves 3/3", opp_c1[1].stats() == (3, 3))
    # The rule the puzzle teaches (Manual, DAMAGE): "Each column ... deals damage
    # equal to the combined power of each unit within that column."
    col_power = sum(u.stats()[0] for u in opp_c1)
    check("column 1 deals 5 (2 + 3), not 2", col_power == 5, col_power)
    check("column 2 deals 3", p.opponent.columns[1][0].stats()[0] == 3)
    check("blocking the wrong column is lethal (5 > 4 life)", 5 > p.you.life)
    check("blocking the right column survives (3 < 4 life)", 3 < p.you.life)

    section("stat modifiers")
    u = wtp.Unit(card="Bumblecrab", power=2, toughness=2, damage=3)
    check("buffs add to printed stats", u.stats() == (4, 5), u.stats())
    check("3 damage on a 5-toughness unit is not lethal", not u.dead())
    check("5 damage on it is", wtp.Unit(card="Bumblecrab", damage=3).dead())
    virus = wtp.Unit(card="Bumblecrab", power=-7, toughness=-7)
    check("a Virus's -7/-7 shrinks it", virus.stats() == (-5, -4), virus.stats())

    section("tokens — the only text-free bodies in the game")
    # Two cards word it differently and both land on an X/X: Generic Unit is
    # printed X/X, a Robot is printed 0/0 and spawns with X +1/+1 counters.
    check("Generic Unit needs an X", wtp.needs_x(wtp.CARDS.cards["Generic Unit"]))
    check("Robot needs an X (its counters)", wtp.needs_x(wtp.CARDS.cards["Robot"]))
    check("a normal unit doesn't", not wtp.needs_x(wtp.CARDS.cards["Tidal Menace"]))
    check("Wisp is a token but has a printed body, so no X",
          not wtp.needs_x(wtp.CARDS.cards["Wisp"]))
    check("these are the only two", sorted(
        n for n in wtp.CARDS.names if wtp.needs_x(wtp.CARDS.cards[n])
    ) == ["Generic Unit", "Robot"])

    check("a Generic Unit 3 is a 3/3",
          wtp.Unit(card="Generic Unit", x=3).stats() == (3, 3))
    check("a Robot 2 is a 2/2", wtp.Unit(card="Robot", x=2).stats() == (2, 2))
    check("a Robot 2 with a +1/+1 on it is a 3/3",
          wtp.Unit(card="Robot", x=2, power=1, toughness=1).stats() == (3, 3))
    check("its BASE reads as the token's size, not the printed 0/0",
          wtp.Unit(card="Robot", x=2, power=1).base_stats() == (2, 2))
    check("Wisp keeps its printed 0/1", wtp.Unit(card="Wisp").stats() == (0, 1))

    robot0 = wtp.from_json({**SAMPLE, "you": {"columns": [[{"card": "Robot"}]]}})
    check("a token with no X warns (it'd be a 0/0)",
          any("give it an X" in w for w in wtp.validate(robot0)))
    robot2 = wtp.from_json({**SAMPLE, "you": {"columns": [[{"card": "Robot", "x": 2}]]}})
    check("a Robot 2 is clean", not any("give it an X" in w for w in wtp.validate(robot2)))
    check("x survives serialisation",
          wtp.to_json(robot2)["you"]["columns"][0][0] == {"card": "Robot", "x": 2},
          wtp.to_json(robot2)["you"]["columns"][0][0])
    rp = wtp.payload(robot2)["you"]["columns"][0][0]
    check("the payload flags it as a token", rp["token"] is True and rp["x"] == 2)
    check("and carries its computed body", (rp["power"], rp["toughness"]) == (2, 2))

    section("resources are mana AND affinity")
    check("mana is the resource count", p.opponent.mana == 3, p.opponent.mana)
    check("affinity is per element", p.opponent.affinity("earth") == 2)
    check("an element you have none of is 0 affinity", p.opponent.affinity("water") == 0)
    check("elements track combos.COLORS (expansion-ready)",
          wtp.ELEMENTS == ("fire", "water", "earth", "metal", "wood"), wtp.ELEMENTS)

    section("validation catches designer mistakes")
    bad = wtp.from_json({**SAMPLE, "you": {
        "columns": [[{"card": "Definitely Not A Card"}]]}})
    check("unknown card name warns", any("Definitely Not A Card" in w
                                         for w in wtp.validate(bad)))
    dead = wtp.from_json({**SAMPLE, "you": {
        "life": 4, "columns": [[{"card": "Bumblecrab", "damage": 9}]]}})
    check("an already-dead unit warns", any("already be dead" in w
                                            for w in wtp.validate(dead)))
    nosol = wtp.from_json({**SAMPLE, "solution": ""})
    check("a missing solution warns", any("No solution" in w for w in wtp.validate(nosol)))

    for bad_input, why in [
        ({**SAMPLE, "title": ""}, "no title"),
        ({**SAMPLE, "question": ""}, "no question"),
        ({**SAMPLE, "phase": "Untap"}, "bad phase"),
        ({**SAMPLE, "turn": "nobody"}, "bad turn"),
        ({**SAMPLE, "difficulty": "impossible"}, "bad difficulty"),
        ({**SAMPLE, "you": {"columns": [[{"card": "A"}, {"card": "B"}, {"card": "C"}]]}},
         "three-deep column"),
        ({**SAMPLE, "you": {"resources": {"lava": 2}}}, "bad element"),
    ]:
        try:
            wtp.from_json(bad_input)
            check(f"rejects {why}", False)
        except wtp.PuzzleError:
            check(f"rejects {why}", True)

    section("ids")
    check("normalizes a bare seed", wtp.normalize_id("7gk2qx") == "wtp-7GK2QX")
    check("normalizes a full id", wtp.normalize_id(" WTP-7gk2qx ") == "wtp-7GK2QX")
    for bad in ("", "wtp-", "nope!", "wtp-abc$"):
        try:
            wtp.normalize_id(bad)
            check(f"rejects id {bad!r}", False)
        except wtp.PuzzleError:
            check(f"rejects id {bad!r}", True)
    check("minted ids are valid", wtp.normalize_id(wtp.mint_id()).startswith("wtp-"))

    section("round-trip through disk")
    tmp = Path(tempfile.mkdtemp())
    real_dir = wtp.PUZZLE_DIR
    try:
        wtp.PUZZLE_DIR = tmp
        saved = wtp.save(p)
        check("writes <id>.json", (tmp / f"{saved.id}.json").exists())
        back = wtp.load(saved.id)
        check("loads back identical", wtp.to_json(back) == wtp.to_json(p))
        check("json is hand-editable (no nulls)",
              "null" not in (tmp / f"{saved.id}.json").read_text())
        check("load_all finds it", [x.id for x in wtp.load_all()] == [saved.id])

        # A file that won't parse must not break the list for everyone else.
        (tmp / "wtp-BROKEN.json").write_text("{ not json")
        check("a corrupt puzzle file is skipped, not fatal",
              [x.id for x in wtp.load_all()] == [saved.id])

        try:
            wtp.load("wtp-NOPE")
            check("missing puzzle raises", False)
        except wtp.PuzzleError:
            check("missing puzzle raises", True)

        wtp.delete(saved.id)
        check("delete removes it", not (tmp / f"{saved.id}.json").exists())

        section("pick_next — serve what you haven't seen")
        made = []
        for i in range(4):
            made.append(wtp.save(wtp.from_json({**SAMPLE, "title": f"P{i}"})))
        ids = {x.id for x in made}
        all_p = wtp.load_all()
        rng = random.Random(7)

        chosen, why = wtp.pick_next(all_p, [], rng=rng)
        check("with nothing seen, anything is fair game", chosen.id in ids)
        check("and it says why", why == "new")

        seen = [x.id for x in made[:3]]
        chosen, why = wtp.pick_next(all_p, seen, rng=rng)
        check("prefers the unseen one", chosen.id == made[3].id and why == "new")

        # Everything seen: the one seen LONGEST ago comes back.
        all_seen = [made[2].id, made[0].id, made[1].id, made[3].id]
        chosen, why = wtp.pick_next(all_p, all_seen, rng=rng)
        check("once all seen, recycles the stalest", chosen.id == made[2].id, chosen.id)
        check("and says so", why == "again")

        chosen, _ = wtp.pick_next(all_p, [], exclude=made[0].id, rng=rng)
        check("exclude is honoured (the 'another one' button)", chosen.id != made[0].id)
        check("no puzzles -> (None, None)", wtp.pick_next([], []) == (None, None))
    finally:
        wtp.PUZZLE_DIR = real_dir
        shutil.rmtree(tmp, ignore_errors=True)

    section("payload (what the page renders from)")
    d = wtp.payload(p, art_url=lambda n: f"/art/{n}")
    check("no solution leaks into the board payload", "solution" not in d)
    check("hint COUNT is exposed, not the hints", d["hint_count"] == 1 and "hints" not in d)
    check("solution=True opts in", "solution" in wtp.payload(p, solution=True))
    front = d["opponent"]["columns"][0][0]
    check("units carry effective stats", (front["power"], front["toughness"]) == (2, 3))
    check("units carry art", front["art_url"] == "/art/Bumblecrab")
    check("known cards are flagged", front["known"] is True)
    check("mana is precomputed", d["you"]["mana"] == 3)
    check("hand is resolved to cards", d["you"]["hand"][0]["card"] == "Sprouter")
    check("status line reads right",
          wtp.status_line(p) == "Battle phase · Opponent's turn · Opponent has initiative",
          wtp.status_line(p))

    section("mods (a grafted unit reads as the stack)")
    m = wtp.from_json({**SAMPLE, "you": {"columns": [
        [{"card": "Plodding Pebble", "mods": ["A Fast Pile of Rocks"]}]]}})
    mu = wtp.payload(m)["you"]["columns"][0][0]
    check("mods are listed", mu["mods"] == ["A Fast Pile of Rocks"])
    check("combined text is the stack's, not the host's",
          "Rockfall" in mu["text"], mu["text"][:80])
    check("host keeps its own stats (it stays the main card)",
          (mu["power"], mu["toughness"]) == (0, 4), (mu["power"], mu["toughness"]))
    illegal = wtp.from_json({**SAMPLE, "you": {"columns": [
        [{"card": "Sprouter", "mods": ["Bumblecrab"]}]]}})
    check("an illegal graft warns", bool(wtp.validate(illegal)))

    section("board image")
    png = wtp.render_board_image(p)
    check("renders a PNG", png[:8] == b"\x89PNG\r\n\x1a\n")
    check("of a sane size", 20_000 < len(png) < 4_000_000, len(png))
    empty = wtp.from_json({"title": "t", "question": "q"})
    check("an empty board still renders", wtp.render_board_image(empty)[:4] == b"\x89PNG")
    check("emoji in a player name doesn't crash the renderer",
          wtp.render_board_image(wtp.from_json(
              {**SAMPLE, "you": {"name": "You 🔥🌿", "life": 4}}))[:4] == b"\x89PNG")

    section("web endpoints")
    from fastapi.testclient import TestClient
    import app as webapp

    tmp2 = Path(tempfile.mkdtemp())
    wtp.PUZZLE_DIR = tmp2
    try:
        c = TestClient(webapp.app)

        r = c.post("/api/wtp/save", json={"puzzle": SAMPLE})
        check("POST /api/wtp/save", r.status_code == 200, r.text[:120])
        pid = r.json()["id"]
        check("save returns the id", pid.startswith("wtp-"))
        check("save reports warnings", r.json()["warnings"] == [])

        r = c.get(f"/api/wtp/{pid}?session_id=t1")
        check("GET /api/wtp/{id}", r.status_code == 200)
        check("board has no solution in it", "solution" not in r.json())
        check("board carries element icons", "icons" in r.json())

        r = c.get(f"/api/wtp/{pid}/solution?session_id=t1")
        check("GET solution", r.status_code == 200 and r.json()["solution"] == "Block column 1.")
        check("hints come with it", r.json()["hints"] == SAMPLE["hints"])

        r = c.get("/api/wtp/list?session_id=t1")
        check("GET list", r.status_code == 200 and len(r.json()["puzzles"]) == 1)
        check("list knows this browser has seen it", r.json()["puzzles"][0]["seen"] is True)
        check("list knows it was revealed", r.json()["puzzles"][0]["revealed"] is True)

        r = c.get("/api/wtp/list?session_id=someone-else")
        check("a different browser hasn't seen it", r.json()["puzzles"][0]["seen"] is False)

        r = c.get("/api/wtp/next?session_id=fresh-user")
        check("GET next serves a puzzle", r.status_code == 200 and r.json()["id"] == pid)
        check("and says it's new", r.json()["why"] == "new")

        r = c.post("/api/wtp/attempt",
                   json={"puzzle_id": pid, "answer": "block col 1", "session_id": "t1"})
        check("POST attempt", r.status_code == 200)

        r = c.post("/api/wtp/preview", json={"puzzle": {**SAMPLE, "title": "draft"}})
        check("POST preview renders an unsaved puzzle", r.status_code == 200)
        check("preview includes the solution (the designer wrote it)",
              "solution" in r.json())
        check("preview includes warnings", "warnings" in r.json())
        check("preview did NOT write a file", len(list(tmp2.glob("*.json"))) == 1)

        r = c.post("/api/wtp/preview", json={"puzzle": {"title": "", "question": ""}})
        check("preview rejects an invalid puzzle with a readable reason",
              r.status_code == 400 and "title" in r.json()["detail"].lower())

        r = c.get(f"/api/wtp/{pid}/board.png")
        check("GET board.png", r.status_code == 200
              and r.headers["content-type"] == "image/png"
              and r.content[:4] == b"\x89PNG")

        r = c.get("/api/wtp/wtp-NOPE")
        check("unknown puzzle 404s", r.status_code == 404)

        r = c.get("/api/wtp/config")
        cfg = r.json()
        check("GET config", r.status_code == 200 and "edit_key_required" in cfg)
        # The editor autocompletes over PLAYABLE cards, which is not the same list
        # the prose linkifier uses — that one drops "Generic Unit" as a reference
        # card, and it's the only vanilla body in the game.
        check("editor autocomplete includes the tokens",
              {"Robot", "Wisp", "Generic Unit"} <= set(cfg["cards"]))
        check("but not the components (Cardback, Turn Structure)",
              not ({"Cardback", "Turn Structure"} & set(cfg["cards"])))
        check("and it says which cards need an X",
              cfg["x_cards"] == ["Generic Unit", "Robot"], cfg["x_cards"])

        # Editing behind a key: the public-tunnel case.
        webapp.EDIT_KEY = "s3cret"
        r = c.post("/api/wtp/save", json={"puzzle": SAMPLE})
        check("save without the key is refused", r.status_code == 403)
        r = c.post("/api/wtp/save", json={"puzzle": SAMPLE},
                   headers={"X-Edit-Key": "wrong"})
        check("save with a wrong key is refused", r.status_code == 403)
        r = c.post("/api/wtp/save", json={"puzzle": SAMPLE},
                   headers={"X-Edit-Key": "s3cret"})
        check("save with the right key works", r.status_code == 200)
        r = c.get("/api/wtp/list")
        check("playing is never gated by the key", r.status_code == 200)
        webapp.EDIT_KEY = ""

        # Re-saving with an id UPDATES that puzzle; only an id-less save mints a
        # new one. This is what stops the editor's Save button from littering the
        # directory with copies every time you hit it.
        before = len(c.get("/api/wtp/list").json()["puzzles"])
        r = c.post("/api/wtp/save",
                   json={"puzzle": {**SAMPLE, "id": pid, "title": "Renamed"}})
        after = c.get("/api/wtp/list").json()["puzzles"]
        check("re-saving with an id updates in place, no duplicate",
              r.json()["id"] == pid and len(after) == before, f"{before} -> {len(after)}")
        check("and the edit took", c.get(f"/api/wtp/{pid}").json()["title"] == "Renamed")

        r = c.delete(f"/api/wtp/{pid}")
        check("DELETE removes it", r.status_code == 200)
        check("and it's gone", c.get(f"/api/wtp/{pid}").status_code == 404)

        for leftover in c.get("/api/wtp/list").json()["puzzles"]:
            c.delete(f"/api/wtp/{leftover['id']}")
        r = c.get("/api/wtp/next?session_id=x")
        check("no puzzles -> a helpful 404", r.status_code == 404
              and "editor" in r.json()["detail"], r.text[:100])

        check("GET /editor serves the editor",
              c.get("/editor").status_code == 200)
        check("GET /static/board.js is served",
              c.get("/static/board.js").status_code == 200)
        check("GET /static/board.css is served",
              c.get("/static/board.css").status_code == 200)
    finally:
        wtp.PUZZLE_DIR = real_dir
        shutil.rmtree(tmp2, ignore_errors=True)

    print(f"\n{'=' * 46}\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
