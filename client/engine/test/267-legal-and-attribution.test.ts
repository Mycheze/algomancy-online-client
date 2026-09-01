/*
 * 267 · THE LEGAL PAGE SAYS WHAT IS TRUE (BL-15)
 *
 * `ui/legal.ts` is the first thing a stranger reads about this project: the
 * unofficial notice, the attribution, the recommendation to go and buy the real
 * game, and a privacy policy that lists what the server keeps about them.
 *
 * ALL FOUR OF THOSE ROT IN THE SAME WAY. They are prose ABOUT code, kept in a
 * different file from the code, and nothing in a compiler notices when one moves
 * and the other does not. The specific failures this file exists to catch:
 *
 *   · Somebody "helpfully" replaces a shop link with a search page, a shortened
 *     link, or an affiliate wrapper. The two URLs were given by the owner
 *     verbatim on 2026-08-25 and are pinned here character for character.
 *   · The pitch order flips. It is physical > print-and-play > play here free,
 *     and the print-and-play is a FALLBACK, not an equal option. Order is
 *     asserted, not just presence.
 *   · A field is added to `Account`, `Session` or `RecordedGame` and the privacy
 *     page goes on describing the old shape. §3 parses `server/accounts.ts` and
 *     asserts SET EQUALITY with what the page claims to cover — both directions,
 *     so an invented field fails as loudly as a missing one.
 *   · A new file is written to disk on the server, or a new key to the
 *     browser's local storage, and the page never learns about it (§4, §5).
 *   · The "no password reset" consequence gets softened into an apology, or
 *     quietly dropped when somebody adds a reset that does not exist. The page
 *     must describe WHAT IS TRUE TODAY: there is no email, therefore no reset.
 *
 * ⚠ §0 IS THE POSITIVE CONTROL AND IS NOT DECORATION. Every check below is
 * "what I parsed out of the source matches what the page says". Two empty sets
 * match. A regex that stops matching reports a clean sweep over nothing. §0 is
 * what stops this file passing while measuring air — never delete a floor to
 * make a run go green.
 *
 * WHAT THIS FILE CANNOT CHECK, AND DOES NOT PRETEND TO: whether Caleb has been
 * asked. That is the last line of BL-15's `doneWhen`, it is the owner's to
 * obtain ("I'll get it before making it ublick", 2026-08-25), and no assertion
 * here speaks to it. Everything green in this file still leaves that open.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { REPO_ROOT } from '../scripts/paths.mjs';
import {
  BROWSER_KEYS, BUY_PHYSICAL, BUY_PNP, STORED_ACCOUNT, STORED_FILES, STORED_GAME,
  STORED_SESSION, UNOFFICIAL, barHtml, footHtml, installLegal, type StoredLine,
} from '../../ui/legal.ts';

const CLIENT = path.join(REPO_ROOT, 'client');
const LEGAL_TS = path.join(CLIENT, 'ui', 'legal.ts');
const ACCOUNTS_TS = path.join(CLIENT, 'server', 'accounts.ts');
const STATEPATHS_TS = path.join(CLIENT, 'server', 'statepaths.ts');
const UI_DIR = path.join(CLIENT, 'ui');

const read = (p: string): string => fs.readFileSync(p, 'utf8');

/** every name a set of privacy lines claims to account for */
const covered = (lines: readonly StoredLine[]): string[] =>
  lines.flatMap(l => [...l.covers]).sort();

/**
 * The top-level field names of one `interface` in a TypeScript source.
 *
 * Deliberately a small hand parser rather than a regex over the whole file: the
 * interfaces here nest (`opponents: Record<string, { games: number; … }>`), and
 * a regex for `\w+:` would report `games`, `wins` and `losses` as fields of
 * `Account`. Brace-depth is the only thing that tells the two apart.
 */
function interfaceFields(src: string, name: string): string[] {
  const at = src.indexOf(`interface ${name} {`);
  assert.notEqual(at, -1, `no \`interface ${name}\` in the source — this parser is reading the wrong file, or the interface was renamed`);
  const start = src.indexOf('{', at);
  let depth = 0;
  let end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  assert.ok(end > start, `\`interface ${name}\` has no closing brace`);

  const body = src.slice(start + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')     // block and doc comments
    .replace(/\/\/[^\n]*/g, ' ');          // line comments

  // split into members at top-level `;` only — an inner `;` sits inside `{}`,
  // `[]` or `()` and belongs to a nested type
  const members: string[] = [];
  let buf = '';
  depth = 0;
  for (const ch of body) {
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    if (ch === ';' && depth === 0) { members.push(buf); buf = ''; continue; }
    buf += ch;
  }
  members.push(buf);

  return members
    .map(m => /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:/.exec(m)?.[1])
    .filter((n): n is string => Boolean(n))
    .sort();
}

/** every `.ts` directly in ui/ — the browser's own storage lives in these */
const uiSources = (): string[] =>
  fs.readdirSync(UI_DIR).filter(f => f.endsWith('.ts')).map(f => path.join(UI_DIR, f));

/** every `algo…` key this client puts in the browser's local storage */
function browserKeysInSource(): string[] {
  const keys = new Set<string>();
  for (const f of uiSources()) {
    const src = read(f);
    // localStorage.getItem('algoName') — the key written at the call site
    for (const m of src.matchAll(/localStorage\.\w+\(\s*'(algo\w+)'/g)) keys.add(m[1]!);
    // const TOKEN_KEY = 'algoToken'; — the key hoisted to a constant
    for (const m of src.matchAll(/^const \w+ = '(algo\w+)';/gm)) keys.add(m[1]!);
  }
  return [...keys].sort();
}

/** the three pages plus the two pieces of furniture, as one blob of copy */
const allCopy = (): string => read(LEGAL_TS);

// ── §0 the positive controls ──────────────────────────────────────────

test('§0 the sources this file quantifies over are not empty', () => {
  assert.ok(fs.existsSync(LEGAL_TS), 'ui/legal.ts is gone — BL-15 shipped it; find out what replaced it before deleting this file');
  assert.ok(read(ACCOUNTS_TS).length > 5000, 'server/accounts.ts read short — the field parser below would report a clean sweep over nothing');
  assert.ok(uiSources().length >= 20, `only ${uiSources().length} .ts files found in ui/ — the storage-key sweep has gone blind`);

  // and the parser itself works, on an interface whose shape is known and
  // whose nesting is exactly the trap it exists to avoid
  const acct = interfaceFields(read(ACCOUNTS_TS), 'Account');
  assert.ok(acct.length >= 10, `interfaceFields() found only ${acct.length} fields on Account — it has stopped parsing`);
  assert.ok(acct.includes('hash') && acct.includes('username'), 'the parser missed fields it must see');
  const profile = interfaceFields(read(ACCOUNTS_TS), 'Profile');
  assert.ok(!profile.includes('games') || !acct.includes('games'),
    'the parser is flattening nested object types — `opponents: Record<string, { games… }>` must not put `games` on Account');

  assert.ok(barHtml().length > 100 && footHtml().length > 400, 'the furniture renders empty');
  assert.equal(typeof installLegal, 'function',
    'installLegal() is the single hook main.ts calls — if it is gone, nothing on this page is on screen');
});

// ── §1 the two links, verbatim, in the order the owner set ────────────

test('§1 the two shop URLs are exactly the ones the owner gave', () => {
  // Pinned character for character. Owner, 2026-08-25 — do NOT "fix" these into
  // a store search, a short link, or anything with a tracking parameter on it.
  assert.equal(BUY_PHYSICAL, 'https://shop.calebgannon.com/products/algomancy-the-base-game');
  assert.equal(BUY_PNP, 'https://shop.calebgannon.com/products/algomancy-print-and-play-edition');

  const src = allCopy();
  assert.ok(src.includes(BUY_PHYSICAL), 'the physical-game link is not on the page');
  assert.ok(src.includes(BUY_PNP), 'the print-and-play link is not on the page');
});

test('§1 no other outbound link has crept in', () => {
  // A page whose whole job is "go and buy it from the creator" must not grow a
  // second destination without somebody deciding to add one.
  const urls = new Set([...allCopy().matchAll(/https?:\/\/[^\s"'`<>)]+/g)].map(m => m[0]!));
  assert.deepEqual(
    [...urls].sort(), [BUY_PNP, BUY_PHYSICAL].sort(),
    'ui/legal.ts links somewhere new. The two shop URLs are the owner\'s, verbatim; anything '
    + 'else on this page is a decision somebody has to make on purpose, not a helpful addition.',
  );
});

test('§1 the pitch order is physical, then print-and-play', () => {
  // The order is the recommendation. Owner: buy the physical game "or AT LEAST
  // the print and play version, which is cheap and supports the creator" — the
  // cheap one is the fallback for somebody who will not buy a box, not an equal
  // alternative, and swapping them changes what the page is asking for.
  for (const [where, html] of [['the footer', footHtml()], ['the module', allCopy()]] as const) {
    const phys = html.indexOf(BUY_PHYSICAL);
    const pnp = html.indexOf(BUY_PNP);
    assert.ok(phys >= 0 && pnp >= 0, `${where} is missing one of the two links`);
    assert.ok(phys < pnp, `${where} offers the print-and-play before the physical game — the pitch order is fixed`);
  }
  assert.match(allCopy(), /supports the creator/i,
    'the "this supports the creator" line is gone — it is the reason the print-and-play is offered at all');
});

// ── §2 the notice a signed-out visitor cannot miss ────────────────────

test('§2 the unofficial notice exists, and is in the strip rather than behind a click', () => {
  assert.match(UNOFFICIAL, /unofficial/i, 'the notice does not say "unofficial"');
  assert.match(UNOFFICIAL, /not affiliated/i, 'the notice does not say "not affiliated"');
  assert.match(UNOFFICIAL, /Caleb Gannon/, 'the notice does not name the creator it is unaffiliated with');

  // BL-15: "a signed-out visitor sees it without hunting for it". The strip is
  // painted by installLegal() above #app, on every screen that is not the
  // board, and it carries the notice itself — not a link to it.
  const bar = barHtml();
  assert.match(bar, /Unofficial fan project/i, 'the strip no longer states the notice up front');
  assert.match(bar, /[Nn]ot affiliated/, 'the strip no longer says "not affiliated"');
  assert.match(read(LEGAL_TS), /insertBefore\(bar, app\)/,
    'the strip is no longer inserted BEFORE #app — if it has moved below the fold, the '
    + '"without hunting" criterion is no longer met');
});

test('§2 no copy implies a shipped official client exists', () => {
  // BL-15, decided: the Steam page is an intent that is not being worked on.
  const src = allCopy();
  assert.match(src, /there is no official client/i,
    'the About page must say outright that no official client exists — "unofficial" on its own '
    + 'implies there is an official one to be unofficial of');
  assert.ok(!/\bthe official client\b/i.test(src.replace(/no official client/gi, '')),
    'something on this page refers to "the official client" as a thing that exists');
});

// ── §3 the privacy page and the account store agree ───────────────────

test('§3 the privacy page covers exactly what accounts.ts persists', () => {
  const src = read(ACCOUNTS_TS);
  const cases: [string, readonly StoredLine[]][] = [
    ['Account', STORED_ACCOUNT],
    ['Session', STORED_SESSION],
    ['RecordedGame', STORED_GAME],
  ];
  for (const [iface, lines] of cases) {
    const real = interfaceFields(src, iface);
    assert.ok(real.length > 0, `no fields parsed off \`interface ${iface}\``);
    assert.deepEqual(
      covered(lines), real,
      `the privacy page and \`interface ${iface}\` in client/server/accounts.ts disagree.\n`
      + `  the store has: ${real.join(', ')}\n`
      + `  the page says: ${covered(lines).join(', ')}\n`
      + 'A privacy policy is a promise about a data structure. If a field was added, say what it '
      + 'is in STORED_* and the promise is true again; if one was removed, drop its line. Do not '
      + 'edit this assertion.',
    );
  }
});

test('§3 the password paragraph matches how the password is actually handled', () => {
  const accounts = read(ACCOUNTS_TS);
  const src = allCopy();
  // derived, not restated: the page names the KDF because the code uses it
  assert.match(accounts, /scryptSync/, 'accounts.ts no longer hashes with scrypt — the privacy page names scrypt by hand and is now wrong');
  assert.match(src, /scrypt/, 'the privacy page must name the hash it promises');
  assert.match(accounts, /timingSafeEqual/, 'the constant-time compare the page claims is gone');
  assert.match(src, /constant time/i, 'the privacy page no longer mentions the constant-time compare');
  // and the thing that must not quietly become false
  assert.ok(!/\/api\/auth\/(reset|forgot)/.test(read(path.join(CLIENT, 'server', 'api-accounts.ts'))),
    'a password reset route now exists — the privacy page still tells people there is none. '
    + 'Rewrite the page (BL-15 / questions-round36 Q3) before shipping it.');
});

test('§3 "no email, therefore no reset" is stated as a consequence', () => {
  const src = allCopy();
  assert.match(src, /no email/i, 'the page must say there is no email address');
  assert.match(src, /There is no password reset/,
    'the page must state plainly that there is no password reset — it is a consequence of having '
    + 'no email, not an apology, and it is what is true today (questions-round36 Q3 may change it)');
  assert.match(src, /cannot be recovered/i, 'the page must say a forgotten password cannot be recovered');
});

// ── §4 everything the server writes down ──────────────────────────────

test('§4 the page accounts for every file the server writes', () => {
  // statepaths.ts is the one place that names the deployment's mutable state,
  // so it is also the complete list of what a privacy page owes an explanation.
  const getters = [...read(STATEPATHS_TS).matchAll(/^export const (\w+) = \(\): string =>/gm)]
    .map(m => m[1]!).sort();
  assert.ok(getters.length >= 4, `only ${getters.length} runtime-state getters found in statepaths.ts — the sweep has gone blind`);
  assert.deepEqual(
    covered(STORED_FILES), getters,
    'client/server/statepaths.ts names a file the privacy page does not describe (or the page '
    + 'describes one that is gone). Everything the deployment writes to disk is something a '
    + 'reader is owed a sentence about.',
  );
});

test('§4 the saved-game log is described, because it is the big one', () => {
  const src = allCopy();
  assert.match(src, /replay/i, 'the page must say the saved games can be replayed — that is what makes them a full record of how you played');
  assert.match(src, /signed out/i, 'the page must say playing signed out records nothing against you');
});

// ── §5 what the browser keeps ─────────────────────────────────────────

test('§5 the page lists every local-storage key the client sets', () => {
  const real = browserKeysInSource();
  assert.ok(real.length >= 8, `only ${real.length} storage keys found across ui/ — the sweep has gone blind`);
  assert.deepEqual(
    covered(BROWSER_KEYS), real,
    'the client stores something in the browser that the privacy page does not mention (or '
    + 'mentions one it no longer stores). Keys are found two ways: at a `localStorage.x(\'algo…\')` '
    + 'call site, and as a `const KEY = \'algo…\';` at the top of a module.',
  );
});

// ── §6 the terms ──────────────────────────────────────────────────────

test('§6 the terms say free, no economy, makes no money', () => {
  // BL-15, decided: "Free, no economy, no monetization, owner-funded. Not
  // negotiable and should be stated plainly." Three separate claims, so three
  // separate assertions — a page can lose one of them and keep the other two.
  const src = allCopy();
  assert.match(src, /no economy/i, 'the terms must say there is no economy');
  assert.match(src, /makes no\s*<\/b>?\s*money|makes no money|make money from it/i, 'the terms must say it makes no money');
  assert.match(src, /no ads/i, 'the terms must say there are no ads');
  assert.match(src, /free/i, 'the terms must say it is free');
});

test('§6 the card art and the IP are attributed', () => {
  const src = allCopy();
  assert.match(src, /card scan|card art|artwork/i, 'the card images are not attributed');
  assert.match(src, /belongs? to him|is the work of/i, 'the attribution does not say whose work it is');
  assert.match(src, /Caleb Gannon/, 'the creator is not named in the attribution');
});
