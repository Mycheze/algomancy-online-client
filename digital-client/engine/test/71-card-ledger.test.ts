/**
 * The card ledger has to be true, or it is worse than nothing.
 *
 * `card-ledger.ts` declares, card by card, which printed clauses do nothing.
 * These assertions make that declaration checkable in both directions:
 *
 *  1. SWEEP → LEDGER. Every card whose definition is bare-but-printed, or
 *     carries an ability that provably cannot do anything, must have an entry.
 *     This is the assertion that would have caught Harbinger of Immolation.
 *  2. LEDGER → REALITY. Every entry must still be needed. If a card gets
 *     implemented and its entry is left behind, this fails and says so.
 *  3. A TALLY, printed on every run, so the number of dead card halves cannot
 *     be quietly ignored.
 *
 * WHY (1) IS SHAPED THE WAY IT IS
 *
 * Harbinger's dead half was, verbatim:
 *
 *     augmentText: [{
 *       type: 'triggered', events: [],   // PARKED — never fires
 *       label: 'your spell tokens stay through regroup (not implemented)',
 *       effect: { run: () => {} },
 *     }]
 *
 * `events: []` means the trigger is registered against nothing, so it can
 * never fire under any game state — that is not a bug you have to reproduce,
 * it is a property you can read off the definition. The sweep reads exactly
 * those properties, which is why it has teeth a `{todo:true}` test does not:
 * a todo cannot fail, and this can. (See the head of card-ledger.ts for the
 * incident.)
 *
 * The sweep is a FLOOR, not the truth. Some dead halves have no readable
 * shape at all — Suspend collects a target, names the player and then does
 * nothing, which looks like working code — so the ledger is deliberately
 * larger than the sweep. Assertion (2) is what keeps the extra entries honest.
 *
 * (2) FOLLOWS THE HOUSE PATTERN in 68-target-conformance.test.ts: every
 * exemption is listed with its reason, and the list is asserted to be exactly
 * right, so an entry that stops being needed fails as loudly as a card that
 * stops being covered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/cards/registry.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import type { Ability, CardDef, EffectDef } from '../src/cards/dsl.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { CARD_LEDGER, type CardLedgerEntry } from './card-ledger.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '..');

// ── reading a card definition's shape ───────────────────────────────────

/**
 * The printed text with everything that is NOT rules text stripped out, so
 * "bare definition" can be judged against "does this card actually say
 * anything".
 *
 * This matters because MOST bare definitions are correct. Tempest Wrangler is
 * `card('Tempest Wrangler', {})` and that is right: its only ability is the
 * type-line {Alluring} attribute, which comes from printed data. Twenty-five
 * cards in the pool are bare with no printed text at all. What is stripped:
 *
 *  - reminder text — `{i}(…)` and bare parentheticals. "(Any combat damage
 *    from a lethal unit will kill a player.)" is a rules REMINDER of an
 *    engine-side attribute, not text the card has to implement.
 *  - markup tokens — `{/n}`, `{p}`, `{g}`, `{i}`, `{/i}`.
 *  - the Ambush banner, when printed.ambush carries it. The mode is engine
 *    level (R22) and the banner is not the card's own text — that is why Good
 *    Whale, Orblish Horroth, Lurking Slimebeast and Shib are correctly bare.
 *  - a "Discard me" banner, when printed.discardMe carries it (R40), for the
 *    same reason.
 *  - the [Augment] / [once] / [Switch] markers, which are structure.
 */
export function meaningfulText(c: CardDef): string {
  let t = c.text ?? '';
  t = t.replace(/\{i\}\s*\([^)]*\)\s*(\{\/i\})?/g, ' ')
       .replace(/\([^)]*\)/g, ' ')
       .replace(/\{\/?[a-z0-9]+\}/gi, ' ');
  if (c.ambush) t = t.replace(/(\[[^\]]*\]\s*)*Ambush(\s*\[[^\]]*\])*/gi, ' ');
  if (c.discardMe) t = t.replace(/(\[[^\]]*\]\s*)*Discard\s+me\.?/gi, ' ');
  return t.replace(/\[Augment\]|\[once\]|\[Switch\d?\]/gi, ' ').replace(/\s+/g, ' ').trim();
}

const source = (f: unknown) => typeof f === 'function' ? f.toString() : '';
/** function source with comments and string literals removed, so a comment
 *  saying "PARKED" and a runtime log saying it can be told apart */
const bare = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, "''");

/**
 * What an effect's `run` actually does.
 *
 *   'empty'    — nothing but comments and braces. (Harbinger's.)
 *   'log-only' — calls `g.ev(…)` and nothing else, and mutates nothing. An
 *                effect that only writes to the log changes no game state, so
 *                it does not implement anything. Scholar of the Void and
 *                Prediction Prophet are this shape: they log the gap instead
 *                of being invisible, which is better hygiene and still dead.
 *   'real'     — touches state somewhere.
 */
function runShape(f: unknown): 'none' | 'empty' | 'log-only' | 'real' {
  const s = source(f);
  if (!s) return 'none';
  const arrow = s.indexOf('=>');
  if (arrow < 0) return 'real';                    // a non-arrow body: assume it works
  const body = bare(s.slice(arrow + 2));
  if (!body.replace(/[{}\s;]/g, '')) return 'empty';
  const calls = [...body.matchAll(/\bg\.(\w+)\s*\(/g)].map(m => m[1]!);
  const mutates = /[^=!<>]=[^=>]/.test(body) || /\+\+|--|\bpush\(|\bdelete\b/.test(body);
  return (!mutates && calls.length && calls.every(n => n === 'ev')) ? 'log-only' : 'real';
}

/** the card says so itself, in an ability LABEL — prose, so read loosely */
const admitsTheGap = (s: string) => /PARKED|not implemented/i.test(s);
/**
 * The same, read in CODE — `bare()` has already stripped the comments and the
 * string literals, so the only thing left that can "say PARKED" is an
 * IDENTIFIER, and a case-insensitive match on one is a false positive waiting
 * to happen. It happened: R118 gave Borrower of Forms
 * `const parked = g.takeCopySource(…)`, a perfectly live line, and the sweep
 * read it as the card admitting it does nothing. A real park note is written
 * `PARKED`, in caps, every time — so the marker word is case-SENSITIVE here
 * and only here. Verified against the whole pool: this is the only card whose
 * verdict changes, and it changes from wrong to right.
 */
const codeAdmitsTheGap = (s: string) => /PARKED|not implemented/.test(s);

const BEHAVIOR_KEYS = [
  'xMin', 'abilities', 'statics', 'costMods', 'effectAttrs', 'augmentable', 'mustBeTargeted',
  'prophesyFromBin', 'playsIntoFormation', 'spellEffect', 'graftEffect', 'augmentText',
  'replaceRotDamage', 'replaceCombatDamageToPlayer', 'xPreview', 'xPreviewRows',
  // R104's replacement-effect layer. A card whose whole text is a replacement
  // has no abilities and no spellEffect BY CONSTRUCTION — that is the point of
  // the layer, not a gap — so the sweep has to see these or every one of the
  // seven cards report #60 named would read as a bare definition the moment it
  // was fixed. (Cosmic Conspirator did exactly that until this line existed.)
  'amountMods', 'replaceLifeGain', 'replaceCounters',
  'replaceTokenCreation', 'replaceTokenBatch',
  // Worldbender's whole text is a card-step replacement (report #87), so it
  // has no abilities and no spellEffect by construction — same reason as the
  // R104 hooks above.
  'replaceCardStep',
] as const;

/**
 * Every readable reason to believe part of this card does nothing. Empty means
 * the definition looks alive — which is NOT the same as being alive, hence the
 * ledger's hand-listed entries.
 */
export function deadShapes(name: string): string[] {
  const c = getCard(name);
  const out: string[] = [];

  // (a) bare definition, but the card prints rules text. Correct for a vanilla
  //     card, damning for one with text — Writhing Host, Rotling and Trench
  //     Stalker are all just `card('X', {})`.
  if (!BEHAVIOR_KEYS.some(k => (c as unknown as Record<string, unknown>)[k] !== undefined) && meaningfulText(c)) {
    out.push('bare definition, but the card prints rules text');
  }

  const abilities: [string, Ability][] = [
    ...(c.abilities ?? []).map((a, i) => [`abilities[${i}]`, a] as [string, Ability]),
    ...(c.augmentText ?? []).map((a, i) => [`augmentText[${i}]`, a] as [string, Ability]),
  ];
  for (const [where, a] of abilities) {
    // (b) THE HARBINGER SHAPE. A triggered ability registered against no
    //     events cannot fire under any game state, ever.
    if (a.type === 'triggered' && !a.events?.length) {
      out.push(`${where}: events:[] — the trigger can never fire`);
      continue;
    }
    const shape = runShape(a.effect?.run);
    // An empty run is fine when a `when()` is doing the work: the bookkeeping
    // pattern (Mirage Walker, Powerforge Synergist, Ancient One) mutates in
    // when() and returns false so the trigger never queues. Harbinger had no
    // when(), which is why it is caught and they are not.
    // `when` lives on TriggeredAbility only; an activated ability has none, so
    // an empty activated run is always a gap.
    const guarded = a.type === 'triggered' && !!a.when;
    if (shape === 'empty' && !guarded) out.push(`${where}: run body is empty`);
    if (shape === 'log-only') out.push(`${where}: run only writes to the log`);
    if (codeAdmitsTheGap(bare(source(a.effect?.run))) || admitsTheGap(a.label ?? '')) {
      out.push(`${where}: says PARKED / not implemented in its own text`);
    }
  }

  const effects: [string, EffectDef | undefined][] = [
    ['spellEffect', c.spellEffect], ['graftEffect', c.graftEffect?.effect],
  ];
  for (const [where, e] of effects) {
    if (!e) continue;
    const shape = runShape(e.run);
    if (shape === 'empty') out.push(`${where}: run body is empty`);
    if (shape === 'log-only') out.push(`${where}: run only writes to the log`);
    if (codeAdmitsTheGap(bare(source(e.run)))) out.push(`${where}: says PARKED / not implemented`);
  }
  return [...new Set(out)];
}

/**
 * Cards the sweep flags that are genuinely FINE, each with its reason — the
 * 68-target-conformance pattern. Kept tiny on purpose: every name here is a
 * hole in the net, so an entry has to earn itself.
 */
const RESOURCE_FACE_REASON =
  'The printed "When I activate … create a Shard" clause is the MANUAL p.18 general '
  + 'rule reprinted on the card as a reminder, not card-specific behaviour. It is '
  + 'implemented in apply.ts::maybeGrantShard for ALL SEVEN elements and verified on '
  + 'the real activateResource path (12-fire-a conformance sweep). printed.json has '
  + 'only three Resource faces (fire/water/earth), so routing the rule through card '
  + 'definitions would drop the bonus for wood/metal/light/dark and double it for '
  + "these three. `card('X Resource', {})` is the correct definition. See R116.";

const NOT_A_GAP: Record<string, string> = {
  Grox:
    'The [Switch] socket carries no text of its own — the whole ability is a graft '
    + 'CAUSE, and its real payload is the R64 `castCost: { kind: \'eraseBin\', n: 2 }` '
    + 'that gates the activation. The log line exists because an effect resolving in '
    + 'silence is indistinguishable from a bug (test/65-effect-conformance).',
  'Cadaverous Cultivator':
    'Same shape as Grox: a repeatable graft cause whose [Switch] prints no text. The '
    + 'cost (`{ discard: 1 }`) and the [Battle] timing are both real and both gate '
    + 'the activation; the run only announces that the cost was paid.',
  Robot:
    '"I spawn with X +1/+1 counters on me" IS implemented — at every creation site, '
    + 'as spawnUnit(..., { token: true, counters: X }). The token has no behaviour of '
    + 'its own to carry, so `card(\'Robot\', {})` is the correct definition.',

  // ── the three [element] Resource faces (2026-08-23) ────────────────────
  //
  // These carried `gap: 'dead'` ledger entries for weeks, waiting on "the
  // resource-CARD model and a dispatched activation event". That was WRONG,
  // and it is the exact failure mode this file was built to catch, running in
  // the other direction: not a park note outliving its reason, but a park note
  // that never had one. The clause was never card behaviour.
  //
  // "When I activate, if you have at least [r][r][r], create a Shard. {i}(It
  // spawns dormant.)" is the MANUAL p.18 GENERAL RULE, printed on the physical
  // card as a reminder — the same way a land prints its own tap symbol. It is
  // implemented once, in `apply.ts::maybeGrantShard`, and it fires for ALL
  // SEVEN elements. Verified on the real `activateResource` action path, not
  // by inspection (12-fire-a's conformance sweep drives every element).
  //
  // ⚠ DO NOT "IMPLEMENT" THESE CARDS. `printed.json` carries only three
  // Resource faces — fire, water, earth. There is no Wood/Metal/Light/Dark
  // Resource face to hang the rule on. Routing it through card definitions
  // would silently DROP the bonus for four of the seven elements (a live
  // regression, traded for making a park note go away); keeping both would
  // grant two Shards. `card('X Resource', {})` is the correct definition, for
  // the Robot reason: the printed text carries no behaviour the card owns.
  // See R116 and R54's 2026-08-23 correction.
  'Fire Resource': RESOURCE_FACE_REASON,
  'Water Resource': RESOURCE_FACE_REASON,
  'Earth Resource': RESOURCE_FACE_REASON,
};

// ── (1) SWEEP → LEDGER: the assertion that would have caught Harbinger ──

test('every card with a readably-dead half is declared in the card ledger', () => {
  const byName = new Map(CARD_LEDGER.map(e => [e.card, e]));
  const undeclared: string[] = [];
  for (const name of allCardNames()) {
    if (name in NOT_A_GAP) continue;
    const shapes = deadShapes(name);
    if (shapes.length && !byName.has(name)) undeclared.push(`${name} — ${shapes.join('; ')}`);
  }
  assert.deepEqual(undeclared, [],
    'these cards have a half that provably does nothing and no ledger entry:\n  '
    + undeclared.join('\n  ')
    + '\n\nAdd an entry to test/card-ledger.ts quoting the printed clause from '
    + 'printed.json, or — if the shape is a false positive — add the card to '
    + 'NOT_A_GAP with a reason. Do NOT resolve this by adding a { todo: true } '
    + 'test: a todo can never fail, which is exactly how Harbinger of Immolation '
    + 'stayed dead through two playtest reports and a conceded game.');
});

test('the sweep has teeth: it recognises the shape Harbinger of Immolation was fixed out of', () => {
  // Harbinger was fixed on 2026-08-22 (it is a StaticMod with survivesRegroup
  // now), so it can no longer prove anything about itself. Envoy of Lightning
  // was the stand-in until round 17, when R94 built the static→effect-attribute
  // channel and implemented it — so the canary moved on again, exactly the way
  // this assertion's own failure message told it to.
  //
  // CREVICE LURKER is the canary now. R104 built the replacement-effect layer
  // and un-parked Conduit of Pain with it (an `AmountMod` consulted by
  // dealEffectDamageAll), so the canary moved on for the third time — exactly
  // the way this assertion's own failure message told it to.
  //
  // Its definition is byte-for-byte the shape Harbinger had, Envoy had and
  // Conduit had — an inert augmentText entry, `events: []`, an empty run and a
  // label ending "(not implemented)" — it is declared in the ledger, and it is
  // genuinely parked: "[Augment] Abilities cost [one] more to activate or
  // trigger during battle" needs ability-cost TAXATION (R59's CostMod taxes
  // card plays only) plus a pay-to-trigger gate, and R104 built neither.
  const CANARY = 'Crevice Lurker';
  const shapes = deadShapes(CANARY);
  assert.ok(shapes.some(s => /events:\[\]/.test(s)),
    `${CANARY} no longer has the inert-augment shape — if it was implemented, `
    + 'pick another currently-parked card as the canary and say which in this comment');
  assert.ok(CARD_LEDGER.some(e => e.card === CANARY),
    'the canary must itself be declared, or the sweep proves nothing');

  // And the negative half: the sweep must NOT fire on the bookkeeping pattern,
  // or it would be noise and get suppressed. Powerforge Synergist has an empty
  // run guarded by a when() that does the work; Tempest Wrangler is bare
  // because it is genuinely vanilla ({Alluring} comes from printed data).
  for (const fine of ['Powerforge Synergist', 'Tempest Wrangler', 'Mirage Walker', 'Ancient One']) {
    assert.deepEqual(deadShapes(fine), [],
      `${fine} is correctly implemented and must not be flagged — a sweep that cries `
      + 'wolf is a sweep that gets ignored');
  }
});

// ── (2) LEDGER → REALITY: an entry that stops being needed must fail ────

/** cache each cited test file's source */
const sources = new Map<string, string | null>();
function sourceOf(rel: string): string | null {
  if (!sources.has(rel)) {
    const p = path.join(HERE, rel);
    sources.set(rel, fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
  }
  return sources.get(rel)!;
}
/**
 * Every `test(…)` in a file, with its title and whether it is a todo.
 *
 * Parsed from the call HEADER — everything between `test(` and the callback's
 * `=>` — because titles in this repo are routinely string concatenations that
 * themselves contain parentheses ("… (PARKED: a rules question — needs Bena)"),
 * so a regex that stops at the first `)` reads the options object as part of
 * the title and misses `{ todo: true }` entirely. The title is every string
 * literal in the header joined, which makes `includes(needle)` work across a
 * concatenation.
 */
function todoTitles(src: string): { title: string; todo: boolean }[] {
  const out: { title: string; todo: boolean }[] = [];
  for (const m of src.matchAll(/\btest\s*\(/g)) {
    const arrow = src.indexOf('=>', m.index);
    if (arrow < 0) continue;
    const header = src.slice(m.index, arrow);
    const literals = [...header.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(x => x[2]!);
    if (!literals.length) continue;
    out.push({ title: literals.join(''), todo: /todo\s*:\s*true/.test(header) });
  }
  return out;
}

test('every ledger entry names a real card and says what is missing', () => {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of CARD_LEDGER) {
    if (seen.has(e.card)) problems.push(`${e.card}: duplicate ledger entry`);
    seen.add(e.card);
    try { getCard(e.card); } catch { problems.push(`${e.card}: no such card any more`); continue; }
    // The clause has to be quoted, not gestured at — the owner reads this list
    // against the physical cards.
    if (e.missing.trim().length < 15) problems.push(`${e.card}: "missing" must quote the printed clause`);
    if (e.waitingOn.trim().length < 30) problems.push(`${e.card}: "waitingOn" needs a reason, not a shrug`);
    if (e.unverified && !e.note?.trim()) {
      problems.push(`${e.card}: marked unverified with no note saying what was and was not checked`);
    }
    // onlyTrackedHere means no automation can ever re-confirm this entry, so
    // the note has to carry how it WAS confirmed. Without that it is a park
    // comment again, just in a different file.
    if (e.onlyTrackedHere && !e.note?.trim()) {
      problems.push(`${e.card}: onlyTrackedHere with no note saying how the gap was confirmed`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every ledger entry is still needed — delete it when the card is implemented', () => {
  // THE SELF-INVALIDATION. This is the property that keeps the ledger from
  // rotting into the same kind of lie the PARKED comments became: a park note
  // outlives its reason silently (Infernal Wispweaver waited on a suppression
  // layer that had already shipped), and an entry here cannot.
  //
  // An entry stays justified while at least one channel of evidence holds:
  //   · the shape sweep still flags the card, or
  //   · the { todo: true } test it names still exists AND is still a todo, or
  //   · the printed attribute it names is still printed AND the engine still
  //     carries the unimplemented-stat-layer placeholder, or
  //   · it says so itself with `unverified` (which the tally counts, loudly).
  const engineSrc = fs.readFileSync(path.join(ENGINE, 'src', 'engine.ts'), 'utf8');
  // PER ATTRIBUTE, because the two stat layers did not ship together. Stat
  // layer 5 landed in round 17 (R93: {Inverted} negates the net change from
  // base) and stat layer 6 landed on 2026-08-23 (R106: an {Unaware} card, and
  // everything it fights or damages, reads at PRINTED stats). BOTH are code
  // now, so neither attribute has one left to point at and a `deadAttr` entry
  // naming either has lost that channel of evidence for good — which is the
  // file's designed outcome, not a bug in it: the cards work now and the
  // entries are what is left behind. The map stays, with the shape it needs
  // for the NEXT unbuilt layer; a `null` means "shipped, delete the entry".
  const LAYER_PLACEHOLDER: Record<'Unaware' | 'Inverted', string | null> = {
    Inverted: null,
    Unaware: null,
  };

  const stale: string[] = [];
  for (const e of CARD_LEDGER) {
    const why: string[] = [];

    if (deadShapes(e.card).length) why.push('shape');

    if (e.todoTest) {
      const [file, needle] = e.todoTest.split('::');
      const src = file ? sourceOf(file) : null;
      if (src === null) {
        stale.push(`${e.card}: cites "${file}", which does not exist`);
      } else {
        const hits = todoTitles(src).filter(t => t.title.includes(needle ?? ''));
        if (!hits.length) {
          stale.push(`${e.card}: no test in ${file} has a name containing "${needle}"`);
        } else if (!hits.some(t => t.todo)) {
          // A todo that grew into a real test is the happy ending: the card
          // works now, and the ledger entry is the thing left behind. (Several
          // cards legitimately have BOTH — a real test for the half that works
          // and a todo for the half that does not — so it takes ALL of the
          // matches being real to call the entry stale.)
          stale.push(`${e.card}: every test in ${file} matching "${needle}" is a REAL test `
            + 'now, none is a todo — the card looks implemented, so delete this ledger entry');
        } else {
          why.push('todo');
        }
      }
    }

    if (e.deadAttr) {
      const c = getCard(e.card);
      const prints = [...c.attrs, ...c.augmentAttrs].includes(e.deadAttr);
      const placeholder = LAYER_PLACEHOLDER[e.deadAttr];
      if (!prints) stale.push(`${e.card}: no longer prints {${e.deadAttr}} — recheck this entry`);
      else if (placeholder === null) {
        stale.push(`${e.card}: the stat layer {${e.deadAttr}} was waiting on has SHIPPED — the `
          + 'attribute is live, so delete this ledger entry');
      } else if (!engineSrc.includes(placeholder)) {
        stale.push(`${e.card}: engine.ts no longer carries the "${placeholder}" `
          + `placeholder — if the stat layer shipped, {${e.deadAttr}} may be live and `
          + 'this entry is stale');
      } else why.push('attr');
    }

    if (e.unverified) why.push('unverified');
    if (e.onlyTrackedHere) {
      // The most dangerous class in the pool, and the reason this file exists:
      // a dead half with NO machine-checkable trace anywhere — no readable
      // shape, no todo test, no printed attribute. Nothing but a batch-header
      // comment was ever tracking it, which is precisely how Harbinger's
      // second half survived two reports. Declaring it here is the tracking.
      why.push('only-tracked-here');
    }

    if (!why.length) {
      stale.push(`${e.card}: nothing backs this entry any more — the definition looks alive, `
        + 'it names no live todo test and no dead attribute. Either the card was '
        + 'implemented (delete the entry), or re-justify it: add the todo test that '
        + 'documents it, or set unverified: true with a note.');
    }
  }
  assert.deepEqual(stale, [],
    `ledger entries that have outlived their evidence:\n  ${stale.join('\n  ')}`);
});

// ── (3) THE TALLY ───────────────────────────────────────────────────────

test('the ledger reports honestly on how many card halves are dead', () => {
  // Not a threshold — a visible count, printed on every run, so the number is
  // impossible to lose track of. The playtest ledger prints the same way.
  const by = (g: CardLedgerEntry['gap']) => CARD_LEDGER.filter(e => e.gap === g).length;
  const deck = new Set(DECK_LIST);
  const unsafe = CARD_LEDGER.filter(e => e.gap !== 'approximated' && deck.has(e.card));
  const enablers = CARD_LEDGER.filter(e => e.severity === 'deck-enabler');
  const unverified = CARD_LEDGER.filter(e => e.unverified).length;
  const untracked = CARD_LEDGER.filter(e => e.onlyTrackedHere).map(e => e.card);

  assert.ok(CARD_LEDGER.length <= allCardNames().length, 'sanity');
  console.log(
    `    card ledger: ${by('dead')} dead · ${by('partial')} partial · `
    + `${by('approximated')} approximated · ${unverified} unverified`);
  console.log(
    `    ${unsafe.length} of ${DECK_LIST.length} constructed-legal cards have a printed `
    + `clause that silently does nothing (${enablers.length} of them are deck enablers: `
    + `${enablers.map(e => e.card).join(', ')})`);
  console.log(
    `    ${untracked.length} have NO trace anywhere but this file — no readable shape, no `
    + `{ todo: true } test, nothing: ${untracked.join(', ')}`);
});
