/* R276 / CT-142 — THE COST-TOAST TIER, AND THE POPULATION IT MUST COVER.
 *
 * ── THE TICKET, AND THE DECISION THAT UNBLOCKED IT
 *
 * R266 (the owner, round 32): *"NOTHING should only exist in the log."*
 * CT-142 measured what that costs. `244-log-is-not-the-only-surface` derives —
 * from the engine's own source, never from a list — the announcements that
 * have no surface but the log, and ranks the subset where the absence COST the
 * player something they had already paid for: a spell fizzles, a cost cannot be
 * paid so an effect is skipped, a trigger a tax prevented, a declined [cost], a
 * copy not made, no legal target, a discount that expired unused, a life lock,
 * no damage through a column, nothing lured.
 *
 * CT-142 refused to guess which of those deserve a surface, because it is a
 * product call. The owner made it on 2026-08-30: **a shared toast tier** — one
 * notice channel they all use, brief, near the board, no new permanent UI,
 * easy to extend when a twentieth turns up. `ui/toast.ts` is that channel and
 * this file is its guard.
 *
 * ── ⚠ WHAT THIS FILE IS REALLY GUARDING
 *
 * Not "the nineteen sentences are handled". The failure this repo pays for
 * over and over (docs/13-assessment §7.2; report #46, closed with a one-card
 * fix and re-filed by the owner twice as the same class) is a guard whose list
 * is TYPED. So the coverage assertion below is COMPUTED: every `ev()` site in
 * `src/engine.ts` and `src/apply.ts` is parsed out of the source, classified by
 * the shipping module's own exported regexes, turned into the event it would
 * produce, and put through the shipping rule. A twentieth announcement added
 * next month joins the population by itself, and if `costToast` does not toast
 * it this file goes red naming it.
 *
 * ── THE SCANNER IS A SECOND, INDEPENDENT DERIVATION, ON PURPOSE
 *
 * `244` parses the same sites for a different question. Rather than import it
 * (it is a test file: importing it would run its suite), this file re-derives
 * the sites and then asserts its own total against THE NUMBER 244 PINS, read
 * out of 244's source. Two parsers, one number. If they ever disagree, one of
 * them is broken and both files say so. (The tidier end state is one shared
 * scanner both files import; that is a refactor of 244, which is not this
 * agent's to make.)
 *
 * ── ⚠ AND THE POPULATION IS NOT 19, AND NOT 20 EITHER
 *
 * Measured here, per SITE, against the client as it stands after this round:
 *
 *     20  structural sites match ABSENCE ∧ COSTLY   (244 calls these tier 1)
 *    − 1  the regroup token erase — R266 gave it a .promptbar this round
 *    − 2  the two `fizzled` sites — R271 gave them a stack-strip mark
 *    ─────
 *     17  structural announcements with no surface but the log
 *    + 5  the same class in `src/cards/**`, which 244 scopes out of ITS
 *         question ("what does the GAME announce about the rules") and which
 *         is squarely inside THIS one: "did the thing I paid for happen?" does
 *         not care whose text the sentence came from
 *    ─────
 *     22  announcement sites this tier surfaces
 *
 * The ticket's 19 is the number of ROWS in 244's stem table, which is 19 stems
 * covering 20 sites (`the [~] cost cannot be paid` occurs twice). It did NOT
 * move because of R271, contrary to the brief: R271 gave the `fizzled` TYPE a
 * consumer, and 244's inventory is derived per SITE off the event's own data
 * keys, so the type-level change left its count exactly where it was. What
 * moves the number here is that this file asks the surfaces themselves.
 *
 * Seeds 2560-2569.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { effectByKey, type EffectCtx, type ResolvedTarget } from '../../engine/src/cards/dsl.ts';
import { toDeployment } from '../../engine/test/util.ts';
import { client } from './ui-driver.ts';
import {
  ABSENCE, COSTLY, COST_TOAST_HEAD, COST_TOAST_MAX, costToast, costToastHtml, costToasts,
  nextCostToastWake, queueCostToasts, visibleCostToasts, ZONE_CHANGE,
} from '../toast.ts';
import { HOLD_MS, STAGGER_MS } from '../flash.ts';
import type { EngineEvent, EventType, GameState } from '../../engine/src/types.ts';

const ROOT = new URL('../../engine/', import.meta.url).pathname;
const read = (rel: string): string => readFileSync(ROOT + rel, 'utf8');

const ui = await client();

/* ── the source scan ──────────────────────────────────────────────────── */

interface Site { file: string; line: number; type: string; msg: string; keys: string[] }

/** index just past the string/template literal that starts at `i` */
function skipString(s: string, i: number): number {
  const q = s[i]!;
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === q) return j + 1;
    if (q === '`' && s[j] === '$' && s[j + 1] === '{') j = skipBraces(s, j + 1) - 1;
  }
  return s.length;
}
/** index just past the {…} that starts at `i` */
function skipBraces(s: string, i: number): number {
  let d = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j]!;
    if (c === '\'' || c === '"' || c === '`') { j = skipString(s, j) - 1; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) return j + 1; }
  }
  return s.length;
}
/**
 * The source with every comment blanked to spaces — same length, same lines.
 *
 * Not cosmetic, and 244 paid for learning it: `ev()` sites in this engine
 * routinely carry a paragraph of comment BETWEEN the message and the data
 * object, and a comment containing a comma splits the argument list in the
 * wrong place. That is how an earlier pass read R194 as having no data at all.
 */
function stripComments(s: string): string {
  const out = s.split('');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '\'' || c === '"' || c === '`') { i = skipString(s, i) - 1; continue; }
    if (c === '/' && s[i + 1] === '/') {
      const e = s.indexOf('\n', i), end = e < 0 ? s.length : e;
      for (let j = i; j < end; j++) out[j] = ' ';
      i = end - 1;
    } else if (c === '/' && s[i + 1] === '*') {
      const e = s.indexOf('*/', i) + 2;
      for (let j = i; j < e; j++) if (out[j] !== '\n') out[j] = ' ';
      i = e - 1;
    }
  }
  return out.join('');
}
/** the arguments of the call whose '(' is at `open`, split at top level */
function callArgs(s: string, open: number): string[] | null {
  const out: string[] = []; let d = 0, start = open + 1;
  for (let i = open; i < s.length; i++) {
    const c = s[i]!;
    if (c === '\'' || c === '"' || c === '`') { i = skipString(s, i) - 1; continue; }
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') {
      d--;
      if (d === 0) { out.push(s.slice(start, i)); return out; }
    } else if (c === ',' && d === 1) { out.push(s.slice(start, i)); start = i + 1; }
  }
  return null;
}
/** the literal prose of a message expression, each `${…}` hole collapsed to ~ */
function litText(a: string): string {
  let out = '';
  for (let i = 0; i < a.length; i++) {
    const c = a[i]!;
    if (c !== '\'' && c !== '"' && c !== '`') continue;
    const e = skipString(a, i);
    let body = a.slice(i + 1, e - 1);
    if (c === '`') {
      let b = '';
      for (let j = 0; j < body.length; j++) {
        if (body[j] === '$' && body[j + 1] === '{') { j = skipBraces(body, j + 1) - 1; b += '~'; }
        else b += body[j];
      }
      body = b;
    }
    out += ' ' + body;
    i = e - 1;
  }
  return out.replace(/\s+/g, ' ').trim();
}
/** the top-level keys of a `{ … }` data argument */
function dataKeys(a: string): string[] {
  const t = a.trim(); if (!t.startsWith('{')) return [];
  const keys: string[] = []; let d = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (c === '\'' || c === '"' || c === '`') { i = skipString(t, i) - 1; continue; }
    if (c === '(' || c === '[' || c === '{') { d++; continue; }
    if (c === ')' || c === ']' || c === '}') { d--; continue; }
    if (d === 1 && /[a-zA-Z_$]/.test(c)) {
      const m = /^([a-zA-Z_$][\w$]*)\s*[:,}]/.exec(t.slice(i));
      if (m) keys.push(m[1]!);
      while (i < t.length && /[\w$]/.test(t[i]!)) i++;
      i--;
    }
  }
  return [...new Set(keys)];
}
/** every `ev('type', msg, data)` in one file */
function evSites(rel: string): Site[] {
  const s = stripComments(read(rel));
  const out: Site[] = [];
  for (const m of s.matchAll(/\bev\(/g)) {
    const args = callArgs(s, m.index! + m[0]!.length - 1);
    if (!args || args.length < 2) continue;
    const ty = /^\s*'([A-Za-z]+)'\s*$/.exec(args[0]!);
    if (!ty) continue;
    out.push({
      file: rel, line: s.slice(0, m.index).split('\n').length, type: ty[1]!,
      msg: litText(args[1]!), keys: args[2] ? dataKeys(args[2]) : [],
    });
  }
  return out;
}

let STRUCTURAL: Site[] | null = null;
/** the announcements the GAME makes about the rules — 244's scope */
function structuralSites(): Site[] {
  return STRUCTURAL ??= [...evSites('src/engine.ts'), ...evSites('src/apply.ts')];
}
let CARDS: Site[] | null = null;
/** the same class of sentence coming out of a card's own text, plus the DSL
 * helper every targeted effect funnels through. The directory is the list: a
 * set file nobody remembered to add is the blind spot this file is about. */
function cardSites(): Site[] {
  if (CARDS) return CARDS;
  const files = readdirSync(ROOT + 'src/cards/sets').filter(f => f.endsWith('.ts'));
  assert.ok(files.length > 20, `positive control: the sets directory was read (${files.length} files)`);
  return CARDS = [...files.flatMap(f => evSites(`src/cards/sets/${f}`)), ...evSites('src/cards/dsl.ts')];
}

/**
 * The event a site would produce, with its data keys filled in with values of
 * the right SHAPE.
 *
 * ⚠ This is where this file parts company with 244 and gets a different — and
 * more honest — answer. 244 fills every key but `unit`/`seat` with `true`,
 * which is enough for the one surface it asks about (`beatKeys`). It is NOT
 * enough here: `fizzledIds` wants a NUMERIC `id` and `tokenLossNotice` wants an
 * ARRAY `ids`, so filling those with `true` would make two real surfaces answer
 * "no" and would put three announcements into a tier that already has them
 * covered. Shape-faithful filling is the difference between 20 and 17.
 */
function eventOf(s: Site): EngineEvent {
  const data: Record<string, unknown> = {};
  for (const k of s.keys) {
    data[k] = /^(unit|seat|id|host|mod|source|n|x|region|tax|controller)$/.test(k) ? 0
      : /s$/.test(k) ? [1]
        : true;
  }
  return { type: s.type as EventType, msg: s.msg, data };
}

/* ── §0. NON-VACUITY, BEFORE ANY CLAIM IS MADE ────────────────────────── */

test('[R276] the rule convicts and acquits: it is neither empty nor a tautology', () => {
  const sites = structuralSites();
  assert.ok(sites.length > 150, `positive control: the engine was really scanned (${sites.length} sites)`);

  const toasted = sites.filter(s => costToast(eventOf(s)));
  const quiet = sites.filter(s => !costToast(eventOf(s)));
  assert.ok(toasted.length > 0,
    'a rule that toasts nothing guards nothing — every assertion below it would be vacuous');
  assert.ok(quiet.length > toasted.length,
    `a rule that toasts most of the engine is not a tier, it is a firehose `
    + `(${toasted.length} toasted vs ${quiet.length} quiet)`);

  // and the two halves by hand, so a broken scan cannot make the pair above
  // true for the wrong reason
  assert.ok(costToast({ type: 'info', msg: 'Ann: the [2 Fire] cost cannot be paid — that effect is skipped.', data: {} }),
    'positive control: a skipped-for-cost announcement earns a toast');
  assert.equal(costToast({ type: 'info', msg: 'Ann draws a card.', data: {} }), null,
    'negative control: an ordinary announcement does not');
});

test('[R276] the classifiers are the same ones 244 derives the inventory with', () => {
  // ONE definition of the class. ui/toast.ts is the canonical copy and 244
  // carries the second; if either is widened without the other, the shipping
  // rule and the measurement stop describing the same set of announcements and
  // nothing else in the suite would notice.
  const mine = read('../ui/toast.ts');
  const theirs = readFileSync(new URL('./244-log-is-not-the-only-surface.test.ts', import.meta.url), 'utf8');
  const cut = (src: string, from: string, to: string, what: string): string => {
    const i = src.indexOf(from);
    assert.ok(i > 0, `${what} is no longer declared the way this guard reads it`);
    const j = src.indexOf(to, i);
    assert.ok(j > i, `${what} has no ${to} terminator`);
    return src.slice(i, j).replace(/\s+/g, ' ');
  };
  assert.equal(
    cut(mine, 'const ABSENCE = new RegExp([', '].map(w =>', 'ui/toast.ts ABSENCE'),
    cut(theirs, 'const ABSENCE = new RegExp([', '].map(w =>', '244 ABSENCE'),
    'ABSENCE has been widened in one file and not the other');
  assert.equal(
    cut(mine, 'const COSTLY = /', ';', 'ui/toast.ts COSTLY'),
    cut(theirs, 'const COSTLY = /', ';', '244 COSTLY'),
    'COSTLY has been widened in one file and not the other');
});

test('[R276] this scan and the one in 244 agree about how many announcements the engine makes', () => {
  const src = readFileSync(new URL('./244-log-is-not-the-only-surface.test.ts', import.meta.url), 'utf8');
  const m = /assert\.equal\(sites\.length, (\d+),/.exec(src);
  assert.ok(m, '244 no longer pins its own site count in the shape this guard reads — '
    + 'the two derivations can no longer be cross-checked, so fix this reader or the pin');
  assert.equal(structuralSites().length, Number(m[1]),
    'two independent parsers of the same source disagree about how many ev() sites it has; '
    + 'one of them is broken and neither number can be trusted until it is found');
});

/* ── §1. THE POPULATION, COMPUTED ─────────────────────────────────────── */

/** every announcement whose sentence says an absence THAT COST SOMEBODY
 * SOMETHING — before asking whether anything already shows it */
const costlyClass = (sites: readonly Site[]): Site[] =>
  sites.filter(s => s.msg && ABSENCE.test(s.msg) && COSTLY.test(s.msg));

const listing = (l: readonly Site[]): string =>
  l.map(s => `  ${s.file}:${s.line} [${s.type}] ${s.msg}`).join('\n');

test('[R276] the derived tier-1 population, and every member of it earns a toast', () => {
  const costly = costlyClass(structuralSites());
  assert.equal(costly.length, 20,
    'the tier-1 count moved — a new costly absence, or one reworded out of the class.\n'
    + 'AS MEASURED NOW:\n' + listing(costly));

  // THE COVERAGE ASSERTION, and the reason this file exists. Not "these
  // nineteen sentences are handled": every member of a population computed
  // from the engine's own source must come out of the shipping rule with
  // either a toast or a NAMED existing surface. There is no third answer, so a
  // twentieth announcement cannot be silently invisible.
  const toasted = costly.filter(s => costToast(eventOf(s)));
  const surfaced = costly.filter(s => !costToast(eventOf(s)));
  assert.equal(toasted.length, 17,
    'the number of costly absences the toast tier carries has moved.\n'
    + 'TOASTED:\n' + listing(toasted) + '\nNOT TOASTED:\n' + listing(surfaced));

  // …and the three that are not toasted are not toasted BECAUSE something else
  // already draws them, stated as the sentence rather than as a line number
  assert.deepEqual(surfaced.map(s => s.type).sort(), ['erased', 'fizzled', 'fizzled'],
    'something is being kept out of the tier by a surface it does not actually have:\n'
    + listing(surfaced));
  assert.equal(surfaced.filter(s => /unused spell token\(s\) to regroup/.test(s.msg)).length, 1,
    'R266 gave the regroup token erase a promptbar; the toast must not say it a second time');
  assert.equal(surfaced.filter(s => /fizzl/.test(s.msg)).length, 2,
    'R271 gave a fizzled stack item its own mark on the strip; likewise');
});

test('[R276] the two already-surfaced kinds go quiet only because the surface answers yes', () => {
  // The positive control for the exclusions above. Take each excluded site,
  // break the ONE thing the existing surface keys off, and the toast must
  // appear — otherwise the exclusion is a coincidence of wording rather than a
  // real hand-off, and the day that surface changes the announcement vanishes.
  const surfaced = costlyClass(structuralSites()).filter(s => !costToast(eventOf(s)));
  assert.ok(surfaced.length, 'positive control: there is something to check');
  for (const s of surfaced) {
    const ev = eventOf(s);
    // ui/flash.ts::fizzledIds keys off a numeric `id`; ui/inspect.ts::
    // tokenLossNotice keys off a numeric `seat` with a non-empty `ids` array
    const broken: EngineEvent = { type: ev.type, msg: ev.msg, data: { ...ev.data, id: 'x', ids: [], seat: 'x' } };
    assert.ok(costToast(broken),
      `${s.file}:${s.line} is kept out of the toast tier by something other than the surface `
      + `that is supposed to be showing it: ${s.msg}`);
  }
});

test('[R276] the card pool announces the same class and the tier carries that too', () => {
  // 244 scopes src/cards out of ITS question on the grounds that a card
  // narrating its own text sits next to the card saying it. That argument does
  // not survive the move to THIS question: an absence has nothing next to it.
  // So the population is measured over the pool as well, and the same rule
  // decides — no per-card anything.
  const costly = costlyClass(cardSites());
  assert.ok(cardSites().length > 400, `positive control: the pool was scanned (${cardSites().length} sites)`);
  assert.equal(costly.length, 6, 'the pool tier-1 count moved:\n' + listing(costly));

  const toasted = costly.filter(s => costToast(eventOf(s)));
  assert.equal(toasted.length, 5, 'TOASTED:\n' + listing(toasted)
    + '\nNOT:\n' + listing(costly.filter(s => !costToast(eventOf(s)))));

  // the sixth is the surface rule earning its keep rather than an oversight:
  // Phytochemical Protection says "all damage to X is prevented", which reads
  // as costly and is not — and it names a `unit`, so the board pulses it and
  // beatKeys says so without anybody adding an exception for the card
  const quiet = costly.filter(s => !costToast(eventOf(s)));
  assert.equal(quiet.length, 1);
  assert.deepEqual(quiet.map(s => s.keys.includes('unit')), [true],
    'the only pool member the tier drops must be one the board already pulses');
});

test('[R276] the whole tier, as one number, over engine and pool together', () => {
  const all = [...costlyClass(structuralSites()), ...costlyClass(cardSites())];
  const toasted = all.filter(s => costToast(eventOf(s)));
  assert.equal(toasted.length, 22,
    'CT-142 counted 19 rows in the 244 stem table. Per SITE, and after asking every existing '
    + 'surface whether it already draws the thing, the tier is:\n' + listing(toasted));
});

/* ── §2. the rule rejects what it should ──────────────────────────────── */

test('[R276] an absence nobody paid for is not a toast', () => {
  // ABSENCE alone is far too wide — 244 measures 38 log-only announcements and
  // only 20 of them cost anything. The tier is the ranked half; the rest stay
  // in the log, which is what the log is for.
  const absences = structuralSites().filter(s => s.msg && ABSENCE.test(s.msg));
  const notCostly = absences.filter(s => !COSTLY.test(s.msg));
  assert.ok(notCostly.length > 10, `positive control: there are plain absences to reject (${notCostly.length})`);
  const leaked = notCostly.filter(s => costToast(eventOf(s)));
  assert.deepEqual(leaked, [], 'bookkeeping is leaking into the loss channel:\n' + listing(leaked));
});

test('[R276] anything the board already pulses is not a toast', () => {
  // the hand-off to ui/flash.ts::beatKeys, both ways round
  const base = { type: 'info' as EventType, msg: 'Ann: the [2 Fire] cost cannot be paid — that effect is skipped.' };
  assert.ok(costToast({ ...base, data: {} }), 'positive control: with nothing to pulse it toasts');
  assert.equal(costToast({ ...base, data: { unit: 7 } }), null, 'and with a unit to pulse it does not');
  assert.equal(costToast({ type: 'lifeLost', msg: 'Ann: no life is not lost — skipped.', data: { seat: 0 } }), null,
    'a life badge is a surface too');
});

test('[R276] a zone change is its own surface and never a toast', () => {
  assert.ok(ZONE_CHANGE.size > 10, 'positive control: the zone set is populated');
  for (const ty of ZONE_CHANGE) {
    assert.equal(costToast({ type: ty as EventType, msg: 'Grox is skipped and does nothing.', data: {} }), null,
      `${ty} is a zone change: the board already shows it`);
  }
  assert.ok(costToast({ type: 'info', msg: 'Grox is skipped and does nothing.', data: {} }),
    'positive control: the same sentence on a type with no zone behind it DOES toast');
});

test('[R276] an event with no message is not a log line and not a toast either', () => {
  assert.equal(costToast({ type: 'info', msg: '', data: {} }), null);
  assert.equal(costToast({ type: 'stackFlash', msg: '', data: { item: { id: 1 } } }), null);
});

/* ── §3. several in one resolution ────────────────────────────────────── */

test('[R276] identical sentences in one batch coalesce into one row with a count', () => {
  const one: EngineEvent = { type: 'info', msg: 'Ann: the [2 Fire] cost cannot be paid — that effect is skipped.', data: {} };
  const two: EngineEvent = { type: 'info', msg: 'Bo: there is no legal target for that — it does nothing.', data: {} };
  const got = costToasts([one, { ...one }, two, { ...one }]);
  assert.equal(got.length, 2, 'three copies of one sentence is one row, not three');
  assert.equal(got[0]!.n, 3, 'with the count on it, so nothing is hidden by the folding');
  assert.equal(got[1]!.n, 1);
  assert.equal(got[0]!.msg, one.msg, 'and the engine sentence is carried verbatim');
});

test('[R276] distinct losses stack, staggered, and the queue drops what has expired', () => {
  const evs: EngineEvent[] = [1, 2, 3].map(i => ({
    type: 'info', msg: `Ann: the [${i} Fire] cost cannot be paid — that effect is skipped.`, data: {},
  }));
  const q = queueCostToasts([], evs, 1000);
  assert.equal(q.length, 3, 'three different losses are three rows');
  // the dwell is flash.ts constants, never a number invented here — so the
  // toasts move with the client tempo instead of fighting the beat queue
  assert.deepEqual(q.map(t => t.until),
    [1, 2, 3].map(i => 1000 + HOLD_MS + i * STAGGER_MS),
    'each new row is staggered by one beat, so a burst does not arrive and vanish as a block');

  const later = queueCostToasts(q, [], q[0]!.until + 1);
  assert.equal(later.length, 2, 'the expired row is gone from the queue, not merely hidden');
  assert.equal(queueCostToasts(q, [], q[2]!.until + 1).length, 0, 'and eventually all of them');
});

test('[R276] a repeat of a row that is still up refreshes it instead of duplicating it', () => {
  const ev: EngineEvent = { type: 'info', msg: 'Ann: the [2 Fire] cost cannot be paid — that effect is skipped.', data: {} };
  const first = queueCostToasts([], [ev], 1000);
  const again = queueCostToasts(first, [ev], 1500);
  assert.equal(again.length, 1, 'the same loss twice is one row');
  assert.equal(again[0]!.n, 2, 'with two on it');
  assert.ok(again[0]!.until > first[0]!.until, 'and a restarted clock, because it just happened again');
});

test('[R276] the overflow is counted and pointed at the log, never dropped in silence', () => {
  const evs: EngineEvent[] = Array.from({ length: COST_TOAST_MAX + 3 }, (_, i) => ({
    type: 'info' as EventType, msg: `Ann: the [${i} Fire] cost cannot be paid — that effect is skipped.`, data: {},
  }));
  const q = queueCostToasts([], evs, 1000);
  const { shown, more } = visibleCostToasts(q, 1000);
  assert.equal(shown.length, COST_TOAST_MAX, 'the strip is capped');
  assert.equal(more, 3, 'and the rest are counted');
  assert.equal(shown.length + more, q.length, 'nothing is lost between the queue and the screen');
  assert.match(costToastHtml(q, 1000), /costtoastmore">\+3 more/, 'and the count is drawn');
  // newest wins the space: a burst is read from the bottom, and the row that
  // just landed is the one the player is most likely to still be able to act on
  assert.equal(shown[shown.length - 1]!.key, q[q.length - 1]!.key);
});

test('[R276] the strip schedules its own exit', () => {
  const q = queueCostToasts([], [{ type: 'info', msg: 'Ann: the [2 Fire] cost cannot be paid — that effect is skipped.', data: {} }], 1000);
  assert.equal(nextCostToastWake(q, 1000), q[0]!.until, 'there is a moment to repaint at');
  assert.equal(nextCostToastWake(q, q[0]!.until), null, 'and none once the strip is empty');
  assert.equal(nextCostToastWake([], 1000), null);
});

test('[R276] the tier wears one label, because a per-case label map is a typed list', () => {
  const html = costToastHtml(queueCostToasts([], [
    { type: 'info', msg: 'Ann: the [2 Fire] cost cannot be paid — that effect is skipped.', data: {} },
    { type: 'info', msg: 'Bo: there is no legal target for that — it does nothing.', data: {} },
  ], 1000), 1000);
  assert.equal(html.split(COST_TOAST_HEAD).length - 1, 2,
    'both rows carry the shared head — a twentieth announcement must arrive already labelled');
  assert.match(html, /the \[2 Fire\] cost cannot be paid/, 'and the engine sentence under it');
  assert.equal(costToastHtml([], 1000), '', 'and an empty tier draws nothing at all');
  // the sentences reach the page escaped, like everything else this client draws
  const nasty = costToastHtml(queueCostToasts([], [
    { type: 'info', msg: '<b>x</b>: the [2 Fire] cost cannot be paid — skipped.', data: {} },
  ], 1000), 1000);
  assert.equal(/<b>x<\/b>/.test(nasty), false, 'card names are escaped');
});

/* ── §4. a real engine event, through the real rule ───────────────────── */

test('[R276] a spell that resolves with nothing to aim at produces a toast, end to end', () => {
  // R223/R227: an effect entered with no legal target says so and does nothing.
  // The rig is 196-empty-target-fizzle's, because that file already argues at
  // length why starving an effect slot is the reachable way to produce this.
  const h = new Harness(2560);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  const g = new E(structuredClone(h.state) as GameState);
  const before = g.events.length;
  effectByKey('spell:Luminous Arc').run(g, {
    controller: seat, sourceName: 'Luminous Arc', region: g.homeRegion(seat),
    targets: [] as ResolvedTarget[], x: 0, event: null,
    eraseSelf: () => {}, spawnUnder: () => {}, spawnWearing: () => {}, refundBudget: () => {},
    choose: (_k: string, d: { options: { value: unknown }[] }) => d.options[0]?.value,
  } as unknown as EffectCtx);
  const evs = g.events.slice(before);
  assert.ok(evs.some(e => /no legal target/.test(e.msg ?? '')),
    'positive control: the engine really did announce the empty target');

  const got = costToasts(evs);
  assert.equal(got.length, 1, 'exactly one toast off a real batch, not one per event:\n'
    + evs.map(e => `  [${e.type}] ${e.msg}`).join('\n'));
  assert.match(got[0]!.msg, /Luminous Arc: it has no legal target — nothing happens\./,
    'and it carries the engine sentence, naming the card the player is looking at');
});

test('[R276] an ordinary resolution produces no toast at all', () => {
  // the negative control the ui-driver preamble asks for: a channel that fires
  // on everything cannot be measured. A real batch off a real action that cost
  // nobody anything must leave the tier empty.
  const h = new Harness(2561);
  toDeployment(h);
  const evs = h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.ok(evs.some(e => e.msg), 'positive control: the action produced log lines');
  assert.deepEqual(costToasts(evs), []);
});

/* ── §5. THE CLIENT. RED until the ui/main.ts + style.css patch lands ─── */

/** put a state and its batch in front of the client, spending the R150 pacing
 * throttle the way a player would (244 explains why this is necessary) */
function show(state: GameState, events?: EngineEvent[]): string {
  const out = ui.update(state, [], events ? { events } : {});
  return /data-btn="paceskip"/.test(out) ? ui.click({ btn: 'paceskip' }) : out;
}

test('[R276] the client puts a costly absence on the screen and not only in the log', () => {
  const h = new Harness(2562);
  toDeployment(h);
  ui.join(h.state, 0);
  const loss: EngineEvent = {
    type: 'info', msg: 'Luminous Arc: it has no legal target — nothing happens.', data: {},
  };
  const before = show(h.state);
  assert.equal(/costtoast/.test(before), false, 'nothing is claimed before the batch arrives');

  const after = show(h.state, [loss]);
  assert.match(after, /class="costtoasts"/, 'the tier is drawn');
  assert.match(after, /class="costtoasthead">⚠ this did nothing<\/b>/, 'wearing the shared label');
  assert.match(after, /class="costtoastmsg">Luminous Arc: it has no legal target — nothing happens\./,
    'and carrying the engine own sentence, verbatim, beside it');
  assert.ok(ui.has({ btn: 'costtoastclose' }), 'and a way to put it away');
  assert.equal(/costtoast/.test(ui.click({ btn: 'costtoastclose' })), false, 'dismissed');
});

test('[R276] an ordinary batch puts no toast on the screen', () => {
  const h = new Harness(2563);
  toDeployment(h);
  ui.join(h.state, 0);
  const quiet = show(h.state, [
    { type: 'info', msg: 'Ann draws a card.', data: {} },
    { type: 'died', msg: 'Grox dies and nothing is skipped.', data: { unit: 4, seat: 0 } },
    { type: 'info', msg: 'Ann sent no counterattackers — no battle here.', data: {} },
  ]);
  assert.equal(/costtoast/.test(quiet), false,
    'a plain absence and a death are not this channel');
});

test('[R276] the tier has a stylesheet of its own', () => {
  // the strip is position: fixed and has to sit in the one free corner —
  // .glimpsenotice owns bottom right and .toast owns bottom centre. Without
  // this it renders in the document flow, which is worse than not rendering.
  const css = read('../ui/style.css');
  assert.match(css, /\.costtoasts \{[^}]*position: fixed/, 'the strip is placed');
  assert.match(css, /\.netmode \.costtoasts \{[^}]*bottom: 178px/,
    'and lifts above the hand dock in net mode, like every other fixed notice');
  assert.match(css, /\.costtoasthead \{/, 'the shared label has a treatment');
  assert.match(css, /prefers-reduced-motion[\s\S]{0,120}\.costtoast \{ animation: none/,
    'and it respects the motion preference, like .glimpsenotice');
});

test('[R276] the log still carries every one of them', () => {
  // R266 is about the log not being the ONLY surface. Nothing in this round
  // may take a line OUT of it, so the tier is asserted to be additive: every
  // toasted announcement still has a message, which is what puts it in the log.
  const all = [...costlyClass(structuralSites()), ...costlyClass(cardSites())]
    .filter(s => costToast(eventOf(s)));
  assert.ok(all.length > 0, 'positive control: there is a tier to check');
  assert.deepEqual(all.filter(s => !s.msg), [], 'a toast without a log line would be a regression');
});
