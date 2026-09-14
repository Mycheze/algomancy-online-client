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

import { REPO_ROOT } from '../../engine/scripts/paths.mjs';
import {
  BROWSER_KEYS, BUY_PHYSICAL, BUY_PNP, STORED_ACCOUNT, STORED_FILES, STORED_GAME,
  STORED_SESSION, UNOFFICIAL, footHtml, installLegal, type StoredLine,
} from '../legal.ts';

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

  assert.ok(footHtml().length > 400, 'the furniture renders empty');
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

test('§2 the unofficial notice exists, and is in the footer itself rather than behind a click', () => {
  assert.match(UNOFFICIAL, /unofficial/i, 'the notice does not say "unofficial"');
  // the owner, 2026-09-05: "Not (yet) affiliated" — and on 2026-09-14, the day the site went
  // public: "remove the (yet) from the footer". Plain "not affiliated", no parenthesis.
  assert.match(UNOFFICIAL, /not affiliated/i, 'the notice does not say "not affiliated"');
  assert.doesNotMatch(UNOFFICIAL, /\(yet\)/i, 'the notice still says "(yet)" — the owner asked for it to go');
  assert.match(UNOFFICIAL, /Caleb Gannon/, 'the notice does not name the creator it is unaffiliated with');

  // BL-15: "a signed-out visitor sees it without hunting for it". The footer
  // is painted by installLegal() right after #app on every screen that is not
  // the board, its top edge is pulled above the fold, and it carries the
  // notice itself — not a link to it. (There was a strip above #app as well
  // until 2026-09-05; the owner asked for it to go, the footer being enough.)
  const foot = footHtml();
  assert.ok(foot.includes(UNOFFICIAL), 'the footer no longer carries the notice verbatim');
  assert.match(foot, /Buy the (physical|real) game/i, 'the footer no longer links to the shop');
  assert.match(foot, /data-legal="about"/, 'the footer no longer opens the About page');
  const src = read(LEGAL_TS);
  assert.match(src, /insertBefore\(foot, app\.nextSibling\)/,
    'the footer is no longer inserted right after #app');
  assert.match(src, /100dvh - 128px/,
    'the footer is no longer pulled above the fold — the "without hunting" criterion is no longer met');
  assert.equal(/legalbar|barHtml/.test(src), false,
    'the top strip is back — the owner asked for it to go (2026-09-05); the footer is the notice');
});

test('§2 there is an AI-disclosure page, and it says what runs a model and what does not', () => {
  // the owner, 2026-09-05: "add another tab … for 'AI Disclosure' and give the
  // details about the agentic development model"
  const src = read(LEGAL_TS);
  assert.match(src, /ai: \{ title: 'AI disclosure', body: aiHtml \}/, 'the page is not registered in PAGES');
  assert.match(footHtml(), /data-legal="ai"/, 'the footer does not open it');
  assert.match(src, /agentic/i, 'the page does not name the development model');
  assert.match(src, /Claude Code/, 'the page does not say what tool the agent ran in');
  assert.match(src, /judge box/i, 'the page does not name the one place a model runs during play');
  assert.match(src, /No AI decides anything in a game/, 'the page does not say that no model plays the game');
});

test('§2 the disclosure says who developed it and who wrote the code', () => {
  // the owner, 2026-09-05: the disclosure "doesn't include that it's coded by
  // Claude but developed by me"
  const src = allCopy();
  assert.match(src, /Ben Adams/, 'the developer is not named');
  assert.match(src, /written by <b>Claude<\/b>|coded by Claude|written by Claude/i, 'Claude is not credited with the code');
  assert.match(src, /Anthropic/, 'and which Claude');
  assert.match(src, /developed and directed by (<b>)?Ben Adams/i, 'the developed-by sentence is gone');
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

test('§3 the privacy page admits the one thing that leaves the server: the judge', () => {
  // /api/judge proxies the typed question to a paid model (DeepSeek) and
  // store.py logs every answer. "No third parties" was false the day the judge
  // shipped. The page now says so, next to the "nothing is sent anywhere
  // else" claim it qualifies.
  const src = allCopy();
  assert.match(src, /DeepSeek/, 'the privacy page does not name the model provider');
  assert.match(src, /judge/i, 'the privacy page does not mention the judge');
  assert.equal(/no third parties/i.test(src), false,
    '"no third parties" is back in the copy, and it is not true while the judge exists');
});

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

/* ── §7 BL-16: the warning at the door ─────────────────────────────────
 *
 * The privacy page (§3) already states "there is no password reset" — for
 * somebody who goes and reads the privacy page. The owner asked for it where
 * the damage is done, in his own capitals: **"DO NOT FORGET YOUR PASSWORD,
 * THERE IS NO PASSWORD RESET" must be shown at account creation.**
 *
 * ⚠ AT CREATION AND ONLY AT CREATION. A login screen carrying it would be a
 * warning arriving after the moment it is about, and the two screens are one
 * function with one flag — so a change that shows it on both, or on neither,
 * is one character wide and invisible unless both halves are asserted.
 */
const ACCOUNT_UI = path.join(UI_DIR, 'account.ts');

test('§7 account creation carries the warning, in the owner\'s own words', () => {
  const src = read(ACCOUNT_UI);
  assert.match(src, /DO NOT FORGET YOUR PASSWORD/,
    'the create-account screen no longer says it. This is the only thing on this site a player '
    + 'cannot undo: there is no email on the account, so a forgotten password is a lost account '
    + 'and nobody — including the owner — can give it back');
  assert.match(src, /THERE IS NO PASSWORD RESET/,
    'the consequence has gone soft. The owner asked for the consequence, in capitals, because '
    + 'people do not read hints');
  assert.match(src, /data-warn="nopwreset"/,
    'the warning is no longer a marked element, so nothing below can tell which screen it is on');
});

test('§7 …and it is on the CREATE screen, not the log-in one', () => {
  const src = read(ACCOUNT_UI);
  // structural, not a render: the two screens are one function with one flag,
  // so what matters is that the block is inside the `isRegister` arm.
  const block = /\$\{isRegister \? `<p class="pwwarn" data-warn="nopwreset">/.test(src);
  assert.ok(block,
    'the warning is not gated on `isRegister`. Shown on the log-in screen it is a warning '
    + 'arriving after the moment it is about; shown on neither it is not shown at all');
  // positive control: `isRegister` really is the create/log-in discriminator,
  // so the gate above means what this test says it means
  assert.match(src, /const isRegister = authMode === 'register'/,
    'the flag this is gated on is no longer the one that picks the screen');
  assert.match(src, /isRegister \? 'Create account' : 'Log in'/,
    '…and no longer the one that labels the button, so "create screen" is now a guess');
});

test('§7 the warning and the privacy page say the same thing', () => {
  // Two surfaces, one fact. They drift by one of them being rewritten alone,
  // which is exactly how a page ends up promising a reset that does not exist.
  const src = read(ACCOUNT_UI);
  assert.match(src, /no email address on this account/i,
    'the warning must say WHY there is no reset — otherwise it reads as a policy somebody could '
    + 'be talked out of, rather than as a consequence of how the account works');
  assert.ok(!/\/api\/auth\/(reset|forgot)/.test(read(path.join(CLIENT, 'server', 'api-accounts.ts'))),
    'a password reset route now exists and the create screen still shouts that there is none');
});
