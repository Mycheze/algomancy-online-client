/* R79 in the CLIENT: a spell on the stack is a mod HOST, and the player has
 * to be able to click it.
 *
 * The report (Bena, 2026-08-22): "Did Caleb rule that you could mod Chitin
 * Shredder onto spells that are on the stack? The engine isn't letting me mod
 * it onto a Fireball." The engine was letting him — `legalActions` has offered
 * `{ type: 'augment', …, hostStack }` since R79 landed. The CLIENT never read
 * the field: the glow behind a mod placement was a `Set<EntityId>`, hosts were
 * matched by entity id, and a `StackItem` is not an `Entity`. Every affordance
 * downstream said "unit" in so many words — the bin banner promised "a unit",
 * the menu entry said "Augment a unit with…", the prompt bar said "pick a
 * glowing host unit" — so the whole ruling was unreachable from the board.
 *
 * The fix is one idea: a stack item is a second KIND of host, not a second
 * feature. `modHosts()` (ui/inspect.ts) splits the engine's own offer into the
 * two kinds, `modHostPhrase()` names whichever kinds are really on offer, and
 * everything downstream reads those instead of assuming.
 *
 * ui/main.ts is a boot script with no DOM harness, so the judgement is tested
 * here directly and the few lines of wiring between it and the page are read
 * as text at the bottom of this file.
 *
 * Seeds 7300-7399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import { modHostCount, modHostPhrase, modHosts } from '../../ui/inspect.ts';
import type { Action, Seat, StackItem } from '../src/types.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';

const onStack = (h: Harness, card: string): StackItem | undefined =>
  h.state.stack.find(i => i.card === card);

/**
 * The exact position in the report: a big fire spell ON THE STACK, a unit in
 * the battle region, and the seat with priority holding a {Virus} it can pay
 * for. Both kinds of host are legal at once, which is the case every affordance
 * used to get wrong.
 */
function virusWindow(seed: number): { h: Harness; A: Seat; D: Seat; virus: number; atk: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');           // 3/3, no attrs, no triggers
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  giveResources(h, D, 'fire', 4);                    // Arc Lightning rr/4
  giveResources(h, A, 'earth', 2);                   // Chitin Shredder ee/2
  pass(h);                                           // A declines the first window
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Arc Lightning') });
  pick(h, { player: A });                            // R67: aimed as it is cast
  const virus = give(h, A, 'Chitin Shredder');
  assert.equal(h.state.priority, A, 'A holds the response window');
  return { h, A, D, virus, atk };
}

/* ── the judgement: which hosts, of which kind ─────────────────────────── */

test('R79: modHosts splits the engine’s offer into units AND spells on the stack', () => {
  const { h, A, virus, atk } = virusWindow(7300);
  const spell = onStack(h, 'Arc Lightning')!;
  const legal = legalActions(h.state, A);

  // the engine offers both — this is the fact the client was throwing away
  assert.ok(legal.some(a => a.type === 'augment' && a.hostId === atk), 'a unit host');
  assert.ok(legal.some(a => a.type === 'augment' && a.hostStack === spell.id), 'and a stack host');

  const hosts = modHosts(legal, { from: 'hand', index: virus, mode: 'augment' });
  assert.ok(hosts.units.has(atk), 'the unit still glows');
  assert.ok(hosts.stack.has(spell.id), 'and so does the spell on the stack');
  assert.equal(modHostCount(hosts), hosts.units.size + hosts.stack.size);
});

test('R79: every glowing stack host is an action the engine accepts', () => {
  // the affordance is driven off `legal`, so the round trip has to close: a
  // card the client lit up must take the click without an IllegalAction.
  const { h, A, virus } = virusWindow(7301);
  const hosts = modHosts(legalActions(h.state, A), { from: 'hand', index: virus, mode: 'augment' });
  assert.ok(hosts.stack.size, 'there is a stack host to click');
  for (const id of hosts.stack) {
    // exactly the action ui/main.ts applyMod() builds for a stack host
    const a: Action = { type: 'augment', seat: A, from: 'hand', index: virus, hostStack: id };
    const after = new Harness(0);
    after.state = structuredClone(h.state);
    after.do(a);
    assert.equal(after.state.stack.length, 2, 'the virus went on above its host');
    assert.equal(after.state.stack[1]!.kind, 'virus');
  }
});

test('R79: the client never invents a host — a virus item is not one', () => {
  // STACK_VIRUS_HOSTS is {spell, spellUnit, spellToken}: a trigger, an ability,
  // an ambusher and another virus are all excluded, each for its own reason.
  // The client does not restate that list; it reads what was offered. So the
  // moment a virus item is itself on the stack, it must not light up.
  const { h, A, D } = virusWindow(7302);
  const spell = onStack(h, 'Arc Lightning')!;
  giveResources(h, D, 'earth', 2);
  const dVirus = give(h, D, 'Chitin Shredder');
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Chitin Shredder'), hostStack: spell.id });

  const virusItem = h.state.stack.find(i => i.kind === 'virus')!;
  assert.equal(h.state.priority, D, 'the response passes to D, who holds a virus of her own');
  const hosts = modHosts(legalActions(h.state, D), { from: 'hand', index: dVirus, mode: 'augment' });
  assert.ok(hosts.stack.has(spell.id), 'the spell underneath is still a host');
  assert.equal(hosts.stack.has(virusItem.id), false, 'the virus in flight is not');
});

test('R79: a graft has no stack form at all', () => {
  const { h, A, virus } = virusWindow(7303);
  const hosts = modHosts(legalActions(h.state, A), { from: 'hand', index: virus, mode: 'graft' });
  assert.equal(hosts.stack.size, 0, 'nothing on the stack is a graft host');
  assert.equal(hosts.units.size, 0, 'Chitin Shredder is not a graft at all');
});

test('modHosts reads one card at a time, or a whole zone at once', () => {
  const { h, A, virus } = virusWindow(7304);
  const legal = legalActions(h.state, A);
  const mine = modHosts(legal, { from: 'hand', index: virus, mode: 'augment' });
  // a card index that is not a mod offers nothing…
  assert.equal(modHostCount(modHosts(legal, { from: 'hand', index: 0, mode: 'augment' })), 0);
  // …and the bin/hand BANNER asks the zone-wide question, before a card is picked
  const zone = modHosts(legal, { from: 'hand', mode: 'augment' });
  assert.deepEqual([...zone.stack], [...mine.stack]);
  assert.equal(modHostCount(modHosts(legal, null)), 0, 'nothing in flight, nothing glowing');
});

/* ── the words every affordance uses ───────────────────────────────────── */

test('modHostPhrase names the kinds actually on offer, and never widens', () => {
  const both = { units: new Set([1]), stack: new Set([2]) };
  assert.equal(modHostPhrase(both), 'unit, or a spell on the stack');
  assert.equal(modHostPhrase({ units: new Set([1]), stack: new Set<number>() }), 'unit');
  assert.equal(modHostPhrase({ units: new Set<number>(), stack: new Set([2]) }), 'spell on the stack');
  // it reads a host SET, not the rules, so a window with no stack host says
  // exactly what it used to — the wording cannot drift ahead of the engine
  assert.equal(modHostPhrase({ units: new Set<number>(), stack: new Set<number>() }), 'unit');
  // and it follows the article the three call sites all put in front of it
  for (const h of [both, { units: new Set<number>(), stack: new Set([2]) }]) {
    assert.doesNotMatch(`a ${modHostPhrase(h)}`, /^a (a|an) /);
  }
});

test('the live position says both kinds, in words', () => {
  const { h, A, virus } = virusWindow(7305);
  const hosts = modHosts(legalActions(h.state, A), { from: 'hand', index: virus, mode: 'augment' });
  assert.equal(modHostPhrase(hosts), 'unit, or a spell on the stack',
    'the prompt bar promised a unit and only a unit, in the one position where that was false');
});

/* ── the wiring in ui/main.ts ───────────────────────────────────────────
 *
 * main.ts takes the document, the socket and the URL at import time, so it
 * cannot be loaded here. Everything above is the judgement, extracted; what
 * follows is the handful of connections between it and the page — each one a
 * line whose deletion puts the feature back out of reach with every test above
 * still green. */

const MAIN = readFileSync(new URL('../../ui/main.ts', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../ui/style.css', import.meta.url), 'utf8');
/** the body of a top-level `function name(...)` in main.ts */
function fn(name: string): string {
  const at = MAIN.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `ui/main.ts has no function ${name}`);
  const end = MAIN.indexOf('\n}\n', at);
  return MAIN.slice(at, end === -1 ? MAIN.length : end);
}

test('the host cache keeps both kinds, from one read of the legal list', () => {
  assert.match(fn('moddingHosts'), /modHosts\(/,
    'moddingHosts() must delegate to the tested helper, not re-derive the set');
  assert.match(MAIN, /let modHostCache: ModHosts/,
    'the cache was a Set<EntityId>, which is why a StackItem could never be in it');
  assert.match(MAIN, /modhost: !opts\.inert && modHostCache\.units\.has\(u\.id\)/,
    'the unit glow reads the units half');
});

test('a stack card wears the host glow, and takes the click', () => {
  const board = fn('stackBoardHtml');
  assert.match(board, /modHostCache\.stack\.has\(it\.id\)/,
    'stackBoardHtml never asked whether the item was a legal host');
  assert.match(board, /modhost \? 'modhost' : ''/,
    'and a host must wear the same class the unit host does');
  assert.match(CSS, /\.stackcard\.modhost\s*\{/,
    'style.css must paint it — the class alone is invisible');

  const click = MAIN.slice(MAIN.indexOf("if (kind === 'stackitem')"));
  const branch = click.slice(0, click.indexOf("if (kind === 'token')"));
  assert.match(branch, /modHostCache\.stack\.has\(id\)/,
    'a click on a glowing stack card must finish the placement');
  assert.match(branch, /applyMod\(m, \{ stack: id \}, e\)/,
    'through the SAME path a unit host uses — one flow, two kinds of host');
});

test('applyMod emits hostStack for a stack host, and hostId for a unit', () => {
  const body = fn('applyMod');
  assert.match(body, /hostStack: host\.stack/, 'the stack host must send hostStack…');
  assert.match(body, /hostId \}\);/, '…and the unit host is untouched');
  assert.match(MAIN, /applyMod\(m, \{ unit: id \}, e\)/, 'the unit click still routes through it');
});

test('the prompt bar, the menu entry and the bin banner all name the real hosts', () => {
  assert.match(fn('moddingBarHtml'), /modHostPhrase\(modHostCache\)/,
    '"pick a glowing host unit" was a promise the engine did not make');
  assert.match(fn('modMenuItems'), /modHostPhrase\(modHosts\(mods,/,
    '"Augment a unit with X" is the entry that starts the whole flow');
  assert.match(fn('binDialogHtml'), /modHostPhrase\(modHosts\(legal,/,
    'the bin banner spelled out "applied to a unit" in prose');
  assert.doesNotMatch(MAIN, /pick a glowing host unit/, 'the old wording is gone');
  assert.doesNotMatch(MAIN, /applied to a unit as a mod/, 'and so is the old banner');
});

test('the focus viewer says what the glow means', () => {
  // the second place a player looks at a stack item (ui/inspect.ts renders the
  // rows; main.ts adds the one line about the mod in flight)
  assert.match(fn('previewStackHtml'), /modHostCache\.stack\.has\(it\.id\)/);
  assert.match(CSS, /\.abmodhost\s*\{/);
});
