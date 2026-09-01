/* R266 / CT-134 — NOTHING SHOULD ONLY EXIST IN THE LOG.
 *
 * ── THE RULING (owner, answering the round-32 question sheet, Q7)
 *
 * *"I don't knwo what warning you're talking about, but no warnings should
 * only exist in the log. In fact, NOTHING should only exist in the log.
 * Everything should be clear in the UI. The log is for checking past things.
 * So this warning about spell tokens should be in the normal warning and
 * choice area, where all the normal buttons are."*
 *
 * The question he was answering: report #131 / R253 hid the game log behind a
 * right-click menu item, and the log had been the client's FALLBACK SURFACE —
 * where anything with no notice of its own ended up. CT-134 filed that cost.
 *
 * ── §1. THE PREMISE, AND HALF OF IT WAS WRONG
 *
 * CT-134 says the unused-spell-token warning "is only ever put on the log".
 * That is true of ONE of its two routes and false of the other, and this file
 * says so before it fixes anything:
 *
 *   - THE PASS. Report #66's actual warning — *"You're about to move to
 *     Regroup which will remove your Spell Tokens. Are you sure?"* — has been
 *     a `.promptbar` confirm since R194, armed by `passEndsBattlePhase` and
 *     fired on the pass that would reach Regroup and on no other window. It
 *     was never log-only. It is ALREADY in the normal warning and choice area,
 *     which is why the owner did not recognise the warning being described.
 *
 *   - THE DECLINE. A round-2 attacker who declines goes `doDeclareAttack` →
 *     `endBattleRound` → `startRegroup` with no priority window anywhere on
 *     the path, so there is no pass to hang a confirm on. R194 announced the
 *     loss instead of preventing it (see docs/digital-rules ## R194 for why
 *     opening the window was rejected), and that announcement went to the log
 *     and nowhere else. THAT is the log-only one, and it is a NOTICE rather
 *     than a warning: the tokens are already gone by the time anyone can be
 *     told. It still goes where the owner put it.
 *
 * ── §2/§3. THE SWEEP, WHICH IS THE POINT
 *
 * *"NOTHING should only exist in the log"* is a whole-client rule, so the
 * deliverable is a MEASUREMENT rather than a mass fix: what else is log-only,
 * how much of it is there, and which of it matters. It is DERIVED — every
 * announcement the engine makes is parsed out of `src/engine.ts` and
 * `src/apply.ts`, and each is asked whether the client shows it anywhere else.
 * A hand-typed list would stop covering new announcements the day somebody
 * added one, which is exactly the failure this ruling is about.
 *
 * ⚠ AND THE THIRD PREMISE WAS WRONG TOO: log-only is NOT cleanly computable at
 * the granularity of the event TYPE. §2 measures why — 48 of the 54 EventType
 * members announce something, and almost every one of them has a surface
 * SOMEWHERE, including 'erased', which is the type the spell-token loss uses.
 * The unit that works is the CALL SITE, and the reason is `info`: a catch-all
 * type with no colour in the log, no curtain, and no consumer, which carries
 * 35 of the 38 log-only announcements. §3 is that measurement.
 *
 * Seeds 2440-2449.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { beatKeys } from '../../ui/flash.ts';
import { tokenLossNotice } from '../../ui/inspect.ts';
import { spawn, toDeployment, toNextBattle } from './util.ts';
import { client } from './ui-driver.ts';
import type { EngineEvent, EntityId, EventType, GameState, Seat } from '../src/types.ts';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (rel: string): string => readFileSync(ROOT + rel, 'utf8');

/** the real client, driven — see test/ui-driver.ts */
const ui = await client();

/* ── the fixture: the CT-55 position, reached through real actions ────── */

/**
 * A round-2 declare step with the ROUND-2 DEFENDER holding castable spell
 * tokens at home — the one state R194 is about. Copied in shape from
 * 165-token-loss-warning, which argues at length why it is reachable.
 */
function declinedOnTokens(seed: number): { h: Harness; loser: Seat; decliner: Seat; toks: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  const def = spawn(h, D, 'Conduit of Pain');
  toNextBattle(h, A);
  const e = new E(h.state);
  const toks = [
    e.createSpellToken(A, 'Fireball', 2, e.homeRegion(A)).id,
    e.createSpellToken(A, 'Poison', 1, e.homeRegion(A)).id,
  ];
  e.settle();
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (let g = 0; g < 40 && h.state.battleRound === 1; g++) {
    const s = h.state;
    if (s.decision) { h.do({ type: 'decide', seat: s.decision.seat, choice: s.decision.options.map((_, i) => i) }); continue; }
    if (s.priority !== null) { h.do({ type: 'passPriority', seat: s.priority }); continue; }
    if (s.battle!.step === 'blocks') { h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [def] }); continue; }
    break;
  }
  assert.equal(h.state.battleRound, 2, 'the fixture reached round 2');
  assert.equal(h.state.battle!.attacker, D, 'and round 2 belongs to the non-initiative seat');
  return { h, loser: A, decliner: D, toks };
}

/**
 * Put a state (and optionally the batch that produced it) in front of the
 * client and return the markup.
 *
 * R150's pacing throttle holds arrivals once a session has a backlog, and a
 * held update paints the ⏭ chip instead of the board — which reads exactly
 * like a notice that failed to appear. So the pacing is flushed through the
 * client's own skip button, the way a player would.
 */
function show(state: GameState, events?: EngineEvent[]): string {
  const out = ui.update(state, [], events ? { events } : {});
  return /data-btn="paceskip"/.test(out) ? ui.click({ btn: 'paceskip' }) : out;
}
function seat(state: GameState, s: Seat): string {
  const out = ui.join(state, s);
  return /data-btn="paceskip"/.test(out) ? ui.click({ btn: 'paceskip' }) : out;
}

/* ── §1. the premise, checked before anything is claimed ──────────────── */

test('[R266] the pass route was never log-only: report 66 warning is already a promptbar confirm', () => {
  const src = read('../ui/main.ts');
  // the bar itself, with the owner's own copy in it
  assert.match(src, /confirmBarHtml\('pass',[\s\S]{0,120}move to Regroup, which will remove your spell tokens/,
    'positive control: the #66 confirm is a real promptbar row, not a log line');
  // …and it is a member of the armed-confirm family, so it carries Go back /
  // Pass anyway like every other irreversible click in this client
  assert.match(src, /pass:\s*\{\s*cancel:\s*'passcancel'/, 'and it is one of the CONFIRM_BARS');
  // the negative half of the premise: it can only hang on a pass
  assert.match(src, /if \(ui\.confirmPass !== null\)/,
    'the confirm is gated on a pass being pending — which is what the decline route does not have');
});

test('[R266] the decline route really did announce the loss to the log and to nothing else', () => {
  const { h, loser, decliner, toks } = declinedOnTokens(2440);
  const at = h.log.length;
  const evs = h.do({ type: 'declareAttack', seat: decliner, columns: [] });

  // the loss happened, on a path with no priority window in it
  assert.equal(h.state.entities[toks[0]!], undefined, 'the tokens really did go');
  assert.equal(h.state.entities[toks[1]!], undefined);
  const line = h.log.slice(at).find(l => /unused spell token\(s\) to regroup/.test(l));
  assert.ok(line, 'R194 announces it');

  // ⚠ THE POINT: it is not in the R65 erased pile, so the erased dialog —
  // the one existing surface for an erase — cannot show it. That is the
  // engine's own deliberate choice (a spell token is not a card) and it is
  // what left this announcement with nowhere to go.
  assert.deepEqual(new E(h.state).erased(loser), [],
    'the tokens are NOT in the public erased pile, so erasedDialogHtml has nothing to draw');

  // and the client can pick it out of the batch by shape, not by prose
  const seen = tokenLossNotice(evs, loser);
  assert.ok(seen, 'tokenLossNotice finds it');
  assert.equal(seen.seat, loser);
  assert.equal(seen.n, 2);
  assert.equal(seen.msg, line);
});

test('[R266] exactly one announcement in the engine has the erased-with-ids-and-no-cards shape', () => {
  // the predicate is a claim about the whole engine, so it is measured over
  // the whole engine rather than over the one call site it was written for.
  // A second erase with this shape would make the notice fire on the wrong
  // thing, and this is what would say so.
  const shaped = allSites().filter(s => s.type === 'erased'
    && s.keys.includes('seat') && s.keys.includes('ids')
    && !s.keys.includes('cards') && !s.keys.includes('card'));
  assert.equal(shaped.length, 1,
    `tokenLossNotice matches erased+seat+ids with no card names; the engine has ${shaped.length} of those:\n`
    + shaped.map(s => `  ${s.file}:${s.line} ${s.msg}`).join('\n'));
  assert.match(shaped[0]!.msg, /unused spell token/, 'and it is the one R194 wrote');
});

test('[R266] the loss is put in front of the player who lost it, in the promptbar area', () => {
  const { h, loser, decliner } = declinedOnTokens(2441);
  const evs = h.do({ type: 'declareAttack', seat: decliner, columns: [] });

  // the client joins as the seat that lost them, then the batch arrives the
  // way the server sends one
  const before = seat(h.state, loser);
  assert.equal(/spell tokens lost/.test(before), false,
    'nothing is claimed before the batch that carries the loss arrives');
  const after = show(h.state, evs);

  assert.match(after, /class="promptbar pending"[\s\S]{0,400}spell tokens lost/,
    'the notice is a promptbar row — "the normal warning and choice area, where all the normal buttons are"');
  assert.match(after, /unused spell token\(s\) to regroup/, 'and it carries the engine own sentence');
  assert.equal(/class="glimpsenotice"[\s\S]{0,200}spell tokens lost/.test(after), false,
    'and it is NOT a corner toast — the owner named the bar, not a notification');
  assert.ok(ui.has({ btn: 'tokenlossclose' }), 'with a way to put it away');

  // …and it goes when it is put away
  const closed = ui.click({ btn: 'tokenlossclose' });
  assert.equal(/spell tokens lost/.test(closed), false, 'dismissed');
});

test('[R266] a net client is not shown the opponent loss, and the notice goes stale at the next battle', () => {
  const { h, loser, decliner } = declinedOnTokens(2442);
  const evs = h.do({ type: 'declareAttack', seat: decliner, columns: [] });

  // the owner asked for this in front of the player who LOST the tokens
  assert.equal(tokenLossNotice(evs, decliner), null, 'not the other seat');
  assert.ok(tokenLossNotice(evs, loser), 'positive control: the losing seat does get it');
  // hotseat is one screen for both players and therefore has no viewer to
  // filter to — null means "whoever it was"
  assert.ok(tokenLossNotice(evs, null), 'and hotseat shows it whichever seat lost');

  seat(h.state, decliner);
  const opp = show(h.state, evs);
  assert.equal(/spell tokens lost/.test(opp), false, 'the decliner is not told about the tokens they burned');

  // staleness: the next battle is the next chance to have tokens, so a notice
  // about the last one has stopped being about anything
  seat(h.state, loser);
  assert.match(show(h.state, evs), /spell tokens lost/, 'up');
  const battling = structuredClone(h.state);
  battling.phase = 'battle';
  assert.equal(/spell tokens lost/.test(show(battling)), false,
    'and down again once a battle is running');
});

test('[R266] an ordinary batch adds nothing to the prompt slot', () => {
  // the negative control the ui-driver note asks for: a surface that renders
  // unconditionally is a surface that cannot be measured. An update carrying
  // events that are NOT a token loss must leave the slot exactly as it was.
  const { h, loser, decliner } = declinedOnTokens(2443);
  // ⚠ AFTER the decline, so the state is out of the battle phase. Run against
  // the pre-decline fixture this whole test is vacuous: gcStaleUi drops the
  // notice on sight during a battle, so every batch below would have looked
  // clean whatever the predicate said. Caught by breaking the predicate and
  // watching nothing go red.
  h.do({ type: 'declareAttack', seat: decliner, columns: [] });
  assert.notEqual(h.state.phase, 'battle', 'positive control: the notice is allowed to stand here');
  seat(h.state, loser);
  const quiet = show(h.state, [
    { type: 'erased', msg: 'X is erased.', data: { seat: loser, cards: ['Grox'] } },
    { type: 'info', msg: 'something happened.', data: { ids: [1, 2] } },
    // …and the forward guard, which is the whole reason the R65 clause is in
    // the predicate rather than left out as unreachable: the day somebody adds
    // card names to a token erase, the erased DIALOG starts showing it and
    // this notice must stand down rather than say the same thing twice.
    { type: 'erased', msg: 'Y loses 1 unused spell token(s) to regroup: Fireball 1.',
      data: { seat: loser, ids: [99], cards: ['Fireball'] } },
    // and the other half of the shape: an erase that names a seat and nothing
    // else. There is no such call site today; the clause is here so that a
    // future one cannot raise a notice with nothing in it.
    { type: 'erased', msg: 'something of yours is erased.', data: { seat: loser } },
    { type: 'erased', msg: 'and nothing at all.', data: { seat: loser, ids: [] } },
  ]);
  assert.equal(/spell tokens lost/.test(quiet), false,
    'an erase WITH card names is the erased pile, and an info with ids is not this');
  assert.equal(tokenLossNotice([{ type: 'erased', msg: 'x', data: { seat: loser, ids: [1] } }], loser)?.n, 1,
    'positive control: strip the card names off that last one and the notice DOES fire');
});

/* ── the derivation the sweep is built on ─────────────────────────────── */

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
 * Not cosmetic. `ev()` call sites in this engine routinely carry a paragraph
 * of comment BETWEEN the message and the data object (R194's own does), and a
 * comment containing a comma splits the argument list in the wrong place —
 * which is how an earlier pass of this measurement read R194's announcement as
 * having no `data` at all and left the ruling's own case out of its inventory.
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
/**
 * THE STRUCTURAL ANNOUNCEMENTS: `src/engine.ts` and `src/apply.ts` only.
 *
 * `src/cards/**` holds ~518 more `ev()` calls and they are a different animal —
 * per-card narration of a card doing the thing its own text says, next to the
 * card that is on screen saying it. The announcements the ruling is about are
 * the ones the GAME makes, about the rules, in nobody's card text.
 */
let SITES: Site[] | null = null;
function allSites(): Site[] {
  return SITES ??= [...evSites('src/engine.ts'), ...evSites('src/apply.ts')];
}

/* ── §2. the type-level sweep, and why it is the wrong unit ───────────── */

/**
 * The EventType union, read out of src/types.ts rather than retyped.
 *
 * Comments are blanked first and only `| 'name'` alternatives are taken. The
 * naive version — every quoted word in the block — reads THREE extra names off
 * the prose in there ('combat', 'recalled', 'modded'), which look exactly like
 * members that no `ev()` call site uses. That is the shape of a false ticket.
 */
function eventUnion(): string[] {
  const t = stripComments(read('src/types.ts'));
  const from = t.indexOf('export type EventType =');
  assert.ok(from > 0, 'src/types.ts still declares EventType as a union');
  const block = t.slice(from, t.indexOf(';', from));
  return [...new Set([...block.matchAll(/\|\s*'([A-Za-z]+)'/g)].map(m => m[1]!))];
}

test('[R266] the type-level question is answerable and gives the wrong answer', () => {
  const union = eventUnion();
  assert.equal(union.length, 54, `EventType has ${union.length} members: ${union.join(' ')}`);

  // an event with an empty message is never a log line (src/harness.ts absorb,
  // and NetBackend.applyUpdate follows the same rule), so ANNOUNCING is the
  // set of types that ever reach the log at all — over the WHOLE tree, cards
  // included, because a type is only silent if every one of its sites is
  const all = [...allSites(), ...evSites('src/cards/dsl.ts')];
  const cardSites = cardEvSites();
  const announcing = new Set([...all, ...cardSites].filter(s => s.msg).map(s => s.type));
  const silent = union.filter(u => !announcing.has(u));
  assert.equal(announcing.size, 48, `${announcing.size} announcing types`);
  assert.deepEqual(silent.sort(), [
    'cardPlayed', 'combatFaceDamage', 'grafted', 'handEntered', 'leftBin', 'stackFlash',
  ], 'the signal-only types, plus the one ("grafted") no ev() call site uses at all');

  // ⚠ AND HERE IS WHY THE TYPE IS THE WRONG UNIT. 'erased' is read by three
  // separate non-log surfaces — and none of them shows the erase this whole
  // ruling is about, because R194 deliberately keeps it out of the R65 pile
  // those surfaces draw from. A type-level sweep scores 'erased' as surfaced
  // and loses the one case the owner asked about.
  const uiSays = uiConsumers();
  assert.ok(uiSays.get('erased')?.length,
    'positive control: some ui module really does read erased events');
  // toast.ts joined on 2026-08-30 when this scan stopped being a typed list —
  // it was a real consumer the old thirteen-name list could not have named.
  assert.deepEqual(uiSays.get('erased')?.sort(), ['flash.ts', 'inspect.ts', 'main.ts', 'toast.ts']);

  // the same measurement, said as a number: two thirds of the announcing types
  // have an event-driven consumer somewhere, which tells you nothing about
  // whether any GIVEN announcement of that type is visible
  const consumed = [...announcing].filter(t => uiSays.has(t));
  // 26 -> 27 on 2026-08-30: R271 gave 'fizzled' a consumer in ui/flash.ts
  // (CT-142 — the stack strip used to label a fizzled item "resolved"). That
  // is the direction this measurement is supposed to move, and it moving is
  // the point of pinning it.
  assert.equal(consumed.length, 27, `${consumed.length} announcing types have a ui consumer`);
});

/** every card file's `ev()` sites — only the TYPES are used, so this is cheap.
 * The directory is the list: a set file nobody remembered to add here is
 * exactly the blind spot this whole file is about. */
function cardEvSites(): Site[] {
  const files = readdirSync(ROOT + 'src/cards/sets').filter(f => f.endsWith('.ts'));
  assert.ok(files.length > 20, `positive control: the sets directory was read (${files.length} files)`);
  const out = files.flatMap(f => evSites(`src/cards/sets/${f}`));
  assert.ok(out.length > 100, `positive control: the card sets really were scanned (${out.length} sites)`);
  return out;
}

/** which ui module reads which event type, with main.ts's two LOG maps blanked
 * — a type named only in `LOG_EVENT_CLASS` or `LOG_PLUMBING` is named BY the
 * log renderer, which is the opposite of having another surface */
function uiConsumers(): Map<string, string[]> {
  const union = eventUnion();
  const out = new Map<string, string[]>();
  // ⚠ THIS WAS A HAND-TYPED LIST OF THIRTEEN FILENAMES until 2026-08-30, and
  // `cardEvSites` twelve lines up already says why that is wrong: "The directory
  // is the list: a set file nobody remembered to add here is exactly the blind
  // spot this whole file is about." The rule was applied to the CARD directory
  // and not to this one. `ui/toast.ts` (R276) was a real fourteenth consumer the
  // list could not know about, and nothing would have gone red — the measurement
  // would just have been quietly smaller than the truth, which is this file's own
  // subject one level up. The directory is the list here too.
  const uiFiles = readdirSync(ROOT + '../ui').filter(f => f.endsWith('.ts')).sort();
  assert.ok(uiFiles.length > 25,
    `positive control: the ui directory was read (${uiFiles.length} files)`);
  for (const f of uiFiles) {
    let t = read('../ui/' + f);
    // ⚠ AN EXCLUSION SET IS NOT A CONSUMER. A module that NAMES an event type in
    // order to say "this one is not mine" is the opposite of a surface for it, and
    // counting it makes this number say the client shows MORE than it does — the
    // direction a coverage number must never drift on its own. main.ts's two log
    // tables were always stripped for this reason; toast.ts's ZONE_CHANGE (R276)
    // is the same shape and is stripped for the same reason. Without this the
    // tally read 32 instead of 27, entirely from seventeen types toast.ts lists
    // to REJECT.
    const strip: Record<string, string[]> = {
      'main.ts': ['LOG_EVENT_CLASS', 'LOG_PLUMBING'],
      'toast.ts': ['ZONE_CHANGE'],
    };
    for (const n of strip[f] ?? []) {
      const i = t.indexOf(`const ${n}`);
      // the declaration may close as `};`, `];` or `]);` — take whichever comes first
      const ends = ['\n};', '\n];', '\n]);'].map(e => t.indexOf(e, i)).filter(x => x > i);
      const j = ends.length ? Math.min(...ends) : -1;
      assert.ok(i > 0 && j > i, `${f} still declares ${n}`);
      t = t.slice(0, i) + ' '.repeat(j - i) + t.slice(j);
    }
    for (const ty of union) if (new RegExp(`'${ty}'`).test(t)) out.set(ty, [...(out.get(ty) ?? []), f]);
  }
  return out;
}

/* ── §3. the call-site sweep: the derived log-only inventory ──────────── */

/**
 * THE THREE SURFACES AN ANNOUNCEMENT CAN ALREADY HAVE, each read off the
 * client's own code rather than asserted:
 *
 *  (1) A PULSE. `ui/flash.ts::beatKeys` is the client's own answer to "what on
 *      the board is this event about?" — a unit id, or a life/bin badge. An
 *      empty answer is the client saying it has nothing to draw the eye to.
 *      Imported, not copied: widening the rule there narrows this inventory.
 *
 *  (2) THE ERASED PILE. `E.ev()` pushes an 'erased' event's `cards`/`card`
 *      onto the seat's public erased list when it carries a numeric `seat`,
 *      and `erasedDialogHtml` draws that list. So an erase WITH card names has
 *      a surface and an erase without them does not — the engine's own gate.
 *
 *  (3) A ZONE CHANGE. Some event types ARE an entity arriving in or leaving a
 *      zone the board draws. "The unit is gone from the board" is a surface
 *      for "the unit died", and this file is deliberately honest about that.
 *      'erased' is NOT in this set, and that is the R65 argument above: an
 *      erase is the one removal that leaves nothing behind to point at, which
 *      is why the erased dialog had to be built in the first place.
 */
const ZONE_CHANGE: ReadonlySet<string> = new Set<EventType>([
  'spawned', 'died', 'despawned', 'trashed', 'tokenCreated', 'controlChanged',
  'leftBin', 'cached', 'prophesied', 'handEntered', 'draw', 'recycle',
  'draft', 'spellPlayed', 'stackPushed', 'resolved', 'negated',
]);

/**
 * THE CLASSIFIER: does this sentence announce that something DID NOT HAPPEN?
 *
 * The whole inventory turns on one observation. An announcement of an ABSENCE
 * cannot have a board surface, because nothing changed on the board — there is
 * no card to fly, no counter to tick, no badge to appear. The player has to
 * INFER it, and the only place it is written down is the log. That is the
 * class the owner's rule is really about, and it is what separates it from the
 * routine bookkeeping the log exists for.
 */
const ABSENCE = new RegExp([
  'no ', 'not ', 'nothing', 'never', 'cannot', "can't", 'can no longer', 'declines?',
  'declined', 'skipped', 'prevented', 'unused', 'stays?', 'already', 'is spent',
  'does nothing', 'is not', 'are not', 'fizzl',
].map(w => `\\b${w}`).join('|'), 'i');

/** …and of those, the ones where the absence COST the player something they
 * had already paid for. The ranking axis the brief asks for: an irreversible
 * loss beats a piece of bookkeeping, every time. */
const COSTLY = /(skipped|does nothing|fizzl|is prevented|not copied|is spent|unused|no legal target|cannot be paid|can no longer be paid|is not gained|is not lost|nothing is paid|nothing is lured|no damage through)/i;

/** the derived inventory: structural announcements with no surface but the log */
function logOnly(): Site[] {
  return allSites().filter(s => {
    if (!s.msg) return false;                       // signal-only: not a log line either
    if (!ABSENCE.test(s.msg)) return false;         // it announces a change; the board has it
    if (ZONE_CHANGE.has(s.type)) return false;      // (3)
    if (s.type === 'erased' && s.keys.includes('seat')
      && (s.keys.includes('cards') || s.keys.includes('card'))) return false;   // (2)
    const data: Record<string, unknown> = {};
    for (const k of s.keys) data[k] = k === 'unit' || k === 'seat' ? 0 : true;
    return beatKeys({ type: s.type as EventType, msg: s.msg, data }).length === 0;   // (1)
  });
}

test('[R266] the derivation itself is alive: every filter it uses matches something and rejects something', () => {
  const sites = allSites();
  // 193 → 199 with BL-06's six test-mode announcements (apply.ts's `sandbox*`
  // handlers). 256-cost-toasts reads this very number out of this file, so it
  // is pinned in exactly one place.
  assert.equal(sites.length, 199, `the engine and apply make ${sites.length} announcements`);
  assert.ok(sites.some(s => s.keys.includes('unit')), 'positive control: sites with a unit key exist');
  assert.ok(sites.some(s => !s.keys.length), 'and sites with no data at all');
  assert.ok(sites.some(s => ABSENCE.test(s.msg)), 'positive control: ABSENCE matches');
  assert.ok(sites.some(s => s.msg && !ABSENCE.test(s.msg)), 'and rejects — it is not a tautology');
  // the pulse rule is imported, so prove the import is the live one
  assert.deepEqual(beatKeys({ type: 'died', msg: 'x', data: { unit: 7, seat: 1 } }), ['e7', '@bin:1']);
  assert.deepEqual(beatKeys({ type: 'erased', msg: 'x', data: { seat: 1, ids: [1] } }), [],
    'and that an erase with a seat and no unit pulses nothing — the whole reason R194 had nowhere to go');
  // and that the message parser really recovered prose, not code
  const spoken = sites.filter(s => s.msg).length;
  assert.ok(spoken > 180, `${spoken} of ${sites.length} sites yielded a message`);
});

test('[R266] the derived inventory of announcements that exist only in the log', () => {
  const inv = logOnly();
  const show = (l: Site[]): string => l.map(s => `  ${s.file}:${s.line} [${s.type}] ${s.msg}`).join('\n');
  assert.equal(inv.length, 38,
    'the count moved — a new announcement with no surface, or one that gained one.\n'
    + 'THE INVENTORY AS MEASURED NOW:\n' + show(inv));

  // it is overwhelmingly ONE type, and that is the structural finding: 'info'
  // is the client's escape hatch. It has no colour in LOG_EVENT_CLASS, no row
  // in LOG_PLUMBING, and no consumer anywhere in ui/ except flash.ts's pacing.
  // Anything with nowhere to go becomes an 'info' line, and an 'info' line
  // with no unit and no seat is invisible everywhere but the log.
  const byType = new Map<string, number>();
  for (const s of inv) byType.set(s.type, (byType.get(s.type) ?? 0) + 1);
  assert.deepEqual([...byType].sort(), [['erased', 1], ['fizzled', 2], ['info', 35]]);
  assert.equal(read('../ui/main.ts').includes("info: 'ev-"), false,
    "'info' earns no colour in the log either — it is the plainest line the panel draws");
});

test('[R266] the ranked half: the announcements where the absence cost the player something', () => {
  const inv = logOnly();
  const costly = inv.filter(s => COSTLY.test(s.msg));
  const rest = inv.filter(s => !COSTLY.test(s.msg));
  assert.equal(costly.length, 20, 'tier 1:\n' + costly.map(s => `  ${s.file}:${s.line} ${s.msg}`).join('\n'));
  assert.equal(rest.length, 18);

  /* THE TICKET LIST. Keyed on a stem of the sentence rather than a line
   * number, because engine.ts moves under this file every round. Every tier-1
   * member must match exactly one stem, so a NEW costly announcement fails
   * here by name instead of quietly joining a count. */
  const STEMS: [string, number][] = [
    ['discount is spent', 1],                                  // a paid-for discount expires unused
    // R271 fixed the LABEL half of this row: the strip says "fizzled" now, and
    // draws the item from `seen` the way it draws a negated one. The row stays
    // because `logOnly` is a per-SITE derivation off the event's own data keys
    // and a `fizzled` event still carries nothing but `{ id }` — which is
    // exactly §2's point about the type being the wrong unit, read backwards.
    ['~ fizzles (~)', 1],
    ['fizzles — all targets are gone', 1],
    ['a part fizzles (target gone)', 1],
    ['a part fizzles (what it was aimed at is gone)', 1],
    ['the [~] cost cannot be paid', 2],
    ['cost must be paid ~ times and cannot be', 1],
    ['the [cost] is declined', 1],
    ['part of the activation cost can no longer be paid', 1],
    ['imposed [sacrifice a unit] cost can no longer be paid', 1],
    ['there is no legal target for that', 1],
    ['is not copied', 1],
    ['the trigger is prevented', 1],
    ['declines to pay', 1],
    ['no damage through', 1],
    ['life (~) is not gained', 1],
    ['life (~) is not lost', 1],
    ['nothing is lured', 1],
    ['unused spell token(s) to regroup', 1],                   // FIXED THIS ROUND — R266
  ];
  const unmatched = costly.filter(s => !STEMS.some(([stem]) => s.msg.includes(stem)));
  assert.deepEqual(unmatched, [],
    'an announcement that costs the player something and has no surface, and no ticket:\n'
    + unmatched.map(s => `  ${s.file}:${s.line} ${s.msg}`).join('\n'));
  for (const [stem, n] of STEMS) {
    assert.equal(costly.filter(s => s.msg.includes(stem)).length, n,
      `stem "${stem}" should match ${n} tier-1 announcement(s)`);
  }
});

test('[R266] one of the thirty-eight now has a surface, and the client really draws it', () => {
  // The measurement above counts the SOURCE, which still has 38 announcements
  // that would be log-only if nobody had built anything. This is the one that
  // no longer is — asserted against the client, not against the count, so the
  // two can never quietly agree with each other while both being wrong.
  const inv = logOnly();
  const promoted = inv.filter(s => /unused spell token\(s\) to regroup/.test(s.msg));
  assert.equal(promoted.length, 1, 'the ruling case is in the inventory it was derived from');

  const src = read('../ui/main.ts');
  assert.match(src, /function tokenLossBarHtml\(\)/, 'R266 built it');
  assert.match(src, /\$\{tokenLossBarHtml\(\)\}\s*\n\s*\$\{promptHtml\(\)\}/,
    'and it is in the prompt slot, above the live question rather than instead of it');
  assert.match(src, /absorbTokenLoss\(m\.events \?\? \[\]\)/, 'fed from the net batch');
  assert.match(src, /absorbTokenLoss\(evs\)/, 'and from the hotseat one');
  assert.match(src, /tokenLossUp = null;\s+\/\/ R266/, 'and dropped by flashReset like every other moment');
});
