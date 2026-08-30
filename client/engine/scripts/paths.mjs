/* Where the shared, repo-level assets live — for everything that reads them
 * off the FILESYSTEM (the build scripts and the tests). The browser's own
 * copy of this question is ui/assets.ts, which deals in URLs, not paths.
 *
 * WHY THIS FILE EXISTS. Nine call sites used to spell `join(here, '..', '..',
 * '..', 'AlgomancyCards')` for themselves, in four different notations. That
 * is not just repetition: the depth is load-bearing and invisible. `engine/`
 * sits exactly three levels below the repo root, and every one of those
 * literals silently encodes that fact. Move this package one level and they
 * all resolve to somewhere that does not exist — or worse, somewhere that
 * does. Now the depth is stated once, here.
 *
 * These are the assets SHARED WITH THE PYTHON BOT (bot/paths.py names the same
 * five things). Neither side owns them; both read them. */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));   // <repo>/client/engine/scripts

/** the repository root — three levels up from engine/ */
export const REPO_ROOT = join(HERE, '..', '..', '..');

/** the card scans, `Card-Name-With-Hyphens.jpg`, plus the oracle data */
export const DATA_DIR = join(REPO_ROOT, 'data');

/** the card scans, `Card-Name-With-Hyphens.jpg`, plus the oracle data */
export const CARDS_DIR = join(DATA_DIR, 'cards');
/** Caleb's card transcription. UPSTREAM CANONICAL — never hand-edit it;
 *  corrections belong in scripts/printed-overrides.mjs. */
export const ORACLE_JSON = join(CARDS_DIR, 'AlgomancyCards-OracleText.json');
/** element pips, cost circles, keyword markers */
export const ICONS_DIR = join(DATA_DIR, 'icons');
/** the rules corpus: manual, glossary, rulebook, dev-logs */
export const RULES_DIR = join(DATA_DIR, 'rules');
/** the checked-in `pdftotext -layout` extraction of the manual */
export const MANUAL_TXT = join(RULES_DIR, 'Algomancy-Manual.txt');
