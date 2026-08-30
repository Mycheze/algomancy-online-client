"""Every filesystem path this project uses, named once.

WHY THIS FILE EXISTS
--------------------
Ten modules used to open with `ROOT = Path(__file__).resolve().parent` and hang
their data directories off it. That works exactly as long as nothing moves. The
moment a file changes depth the constant silently repoints one level wrong —
no ImportError, no failing test, nothing red. You find out when the bot boots
and reports zero cards loaded.

So the paths live here instead. Moving `data/cards/` used to mean editing
five files and hoping; now it means editing one line below.

WHAT IS CANONICAL AND WHAT IS BUILT
-----------------------------------
Canonical, hand-authored, never regenerate:
    ORACLE_JSON             Caleb's card transcription — upstream source of truth
    RULES_DIR/*             the manual, glossary, rulebook, dev-logs
    SEED_RULINGS            hand-transcribed rulings

Generated — rebuild them, never hand-edit them:
    MOD_ANCHORS             <- pipeline/build_anchors.py
    CORPUS                  <- pipeline/build_corpus.py
    GENERATED_RULINGS       <- pipeline/build_rulings.py
    ICONS_DIR/cost_*.webp   <- pipeline/build_cost_icons.py
    ICONS_DIR/once.webp     <- pipeline/build_cost_icons.py

These are names, not promises: nothing here creates a directory or asserts one
exists. Callers that write (store.py, the pipeline scripts) mkdir their own.
"""

from pathlib import Path

#: this file, i.e. bot/
BOT_DIR = Path(__file__).resolve().parent
#: the repository root, one level above bot/
REPO_ROOT = BOT_DIR.parent

# ── shared data: read by BOTH the Python bot and the TypeScript client ───────
# The client reaches these over its own constants (engine/paths.ts, ui/assets.ts)
# and serves the card art and icons as static routes. Keep the two sides in step.
DATA = REPO_ROOT / "data"

CARDS_DIR = DATA / "cards"
ORACLE_JSON = CARDS_DIR / "AlgomancyCards-OracleText.json"
MOD_ANCHORS = CARDS_DIR / "mod_anchors.json"
ICONS_DIR = DATA / "icons"
RULES_DIR = DATA / "rules"

# ── the RAG corpus and the rulings it is built from ─────────────────────────
CORPUS_DIR = DATA / "corpus"
CORPUS = CORPUS_DIR / "algomancy_corpus.jsonl"

RULINGS_DIR = DATA / "rulings"
SEED_RULINGS = RULINGS_DIR / "seed_rulings.jsonl"
GENERATED_RULINGS = RULINGS_DIR / "generated_rulings.jsonl"
RULINGS_EXPORTS = RULINGS_DIR / "exports"       # untracked: raw Discord dumps
NEEDS_OCR = RULINGS_DIR / "needs_ocr.jsonl"     # untracked: image-only messages

# ── the bot's own things ────────────────────────────────────────────────────
WEB_DIR = BOT_DIR / "web"          # the FastAPI app's front-end, still served at /static
PUZZLE_DIR = BOT_DIR / "puzzles"   # "What's the play?" puzzles, one JSON each

# ── runtime state: append-only, gitignored, and the only copy there is ──────
# responses/feedback are the training + eval record; games.jsonl is real user
# state that combos.py reads back. Back these up; never commit them.
LOG_DIR = REPO_ROOT / "logs"
RESPONSES = LOG_DIR / "responses.jsonl"
FEEDBACK = LOG_DIR / "feedback.jsonl"
GENERAL_FEEDBACK = LOG_DIR / "general_feedback.jsonl"
GAMES = LOG_DIR / "games.jsonl"
WTP_ATTEMPTS = LOG_DIR / "wtp_attempts.jsonl"
